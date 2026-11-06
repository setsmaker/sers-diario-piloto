package es.sers.reportajes;

import android.content.ContentResolver;
import android.content.ContentUris;
import android.content.ContentValues;
import android.content.Context;
import android.database.Cursor;
import android.net.Uri;
import android.os.Environment;
import android.provider.MediaStore;
import android.util.Base64;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.BufferedInputStream;
import java.io.BufferedOutputStream;
import java.io.IOException;

import java.io.OutputStream;
import java.io.FileInputStream;
import java.nio.charset.StandardCharsets;
import java.util.HashMap;
import java.util.Map;

/**
 * Copias independientes de WebView: fotos originales en Galería/MediaStore y
 * fichas JSON versionadas en Descargas/SERS_Photo/<id de reportaje>.
 *
 * La copia de imagen y la ficha JSON están fuera de app_webview y la caché.
 * No se borran desde las operaciones habituales de la aplicación.
 */
public final class PhotoArchive {
    private final ContentResolver resolver;
    private final Context context;
    private final Uri images = MediaStore.Images.Media.EXTERNAL_CONTENT_URI;
    private final Uri downloads = MediaStore.Downloads.EXTERNAL_CONTENT_URI;
    private Uri pendingUri;
    private OutputStream pendingStream;
    private long pendingExpected, pendingWritten;
    private String pendingName;
    private String lastError = "";

    public PhotoArchive(Context context) { this.context=context; resolver=context.getContentResolver(); }

    public synchronized String error() { return lastError; }
    private static String clean(String s) {
        String out=String.valueOf(s==null?"":s).replaceAll("[^a-zA-Z0-9_-]","_");
        return out.length()>95?out.substring(0,95):out;
    }
    private static String ext(String s) {
        String x=clean(s).toLowerCase();
        if (x.equals("jpeg")) return "jpg";
        return x.equals("png")||x.equals("webp")||x.equals("heic")||x.equals("jpg")?x:"jpg";
    }
    private static String mime(String ext) {
        if (ext.equals("png"))return "image/png";
        if (ext.equals("webp"))return "image/webp";
        if (ext.equals("heic"))return "image/heic";
        return "image/jpeg";
    }
    private static String pictureName(String photoId,String extension) {
        return "SERS_"+clean(photoId)+"."+ext(extension);
    }
    private static String photoDir(String reportId,String reportName) {
        String shortName=clean(reportName);
        if(shortName.length()>45)shortName=shortName.substring(0,45);
        return Environment.DIRECTORY_PICTURES+"/SERS Photo/"+shortName+"__"+clean(reportId)+"/";
    }
    private static String dataDir(String reportId) {
        return Environment.DIRECTORY_DOWNLOADS+"/SERS_Photo/"+clean(reportId)+"/";
    }
    private Uri search(Uri table,String displayName,String prefixPath) {
        String[] cols={MediaStore.MediaColumns._ID,MediaStore.MediaColumns.RELATIVE_PATH};
        try(Cursor c=resolver.query(table,cols,
            MediaStore.MediaColumns.DISPLAY_NAME+"=?",
            new String[]{displayName},MediaStore.MediaColumns.DATE_MODIFIED+" DESC")){
            if(c!=null)while(c.moveToNext()){
                String p=c.getString(1);
                if(prefixPath==null||p!=null&&p.startsWith(prefixPath))
                    return ContentUris.withAppendedId(table,c.getLong(0));
            }
        }catch(Exception ignored){}
        return null;
    }
    /**
     * Cámara Xiaomi: escribir en un archivo propio con FileProvider primero.
     * No entregar el URI MediaStore al fabricante de la cámara: en determinados
     * dispositivos elimina la fila o la sustituye, produciendo FileNotFound.
     * Este archivo persiste en Android/data/<paquete>/files/Pictures/SersCapture
     * mientras la APK siga instalada, aunque falle la publicación en Galería.
     */
    public synchronized File prepareNativeCapture(String photoId) throws Exception {
        if(photoId==null||!photoId.matches("[A-Za-z0-9_-]{1,150}"))
            throw new Exception("Identificador de fotografía incorrecto.");
        File root=context.getExternalFilesDir(Environment.DIRECTORY_PICTURES);
        if(root==null)throw new Exception("El almacenamiento de fotos no está disponible.");
        File dir=new File(root,"SersCapture");
        if(!dir.isDirectory()&&!dir.mkdirs())throw new Exception("No se pudo crear el directorio de cámara.");
        File file=new File(dir,pictureName(photoId,"jpg"));
        if(file.exists())throw new Exception("Esta fotografía ya tiene una captura guardada.");
        try(FileOutputStream fd=new FileOutputStream(file)){fd.flush();}
        return file;
    }
    public synchronized File getNativeCapture(String photoId) {
        if(photoId==null||!photoId.matches("[A-Za-z0-9_-]{1,150}"))return null;
        File base=context.getExternalFilesDir(Environment.DIRECTORY_PICTURES);
        if(base==null)return null;
        return new File(new File(base,"SersCapture"),pictureName(photoId,"jpg"));
    }
    public synchronized long nativeCaptureSize(String photoId) {
        File source=getNativeCapture(photoId);
        return source!=null&&source.isFile()?source.length():-1;
    }
    public synchronized String copyReturnedUriToCapture(Uri imageUri,String photoId) {
        File destination=getNativeCapture(photoId);
        if(destination==null||imageUri==null)return "ERROR:No hay foto devuelta.";
        try(InputStream input=resolver.openInputStream(imageUri);
            OutputStream output=new FileOutputStream(destination,false)){
            if(input==null)throw new IOException("No se puede abrir la fotografía devuelta por la cámara.");
            byte[] buf=new byte[65536];int len;long total=0;
            while((len=input.read(buf))>=0){
                if(len>0){output.write(buf,0,len);total+=len;}
                if(total>120*1024*1024)throw new IOException("La fotografía es demasiado grande.");
            }
            output.flush();
            if(total<1024)throw new IOException("La fotografía devuelta está vacía.");
            return "OK";
        }catch(Exception error){lastError=error.toString();return "ERROR:"+lastError;}
    }
    public synchronized String publishCameraFile(String reportId,String reportName,String photoId){
        lastError="";
        File source=getNativeCapture(photoId);
        if(source==null||!source.isFile()||source.length()<1024)
            return "ERROR:La cámara no ha escrito una fotografía válida.";
        String name=pictureName(photoId,"jpg");
        Uri entry=null;
        boolean published=false;
        try{
            // No borrar ni sobrescribir fotos públicas ya guardadas.
            Uri existing=search(images,name,Environment.DIRECTORY_PICTURES+"/SERS Photo/");
            if(existing!=null){
                if(actualSize(existing)==source.length())return name;
                return "ERROR:Hay una foto de igual nombre con contenido diferente.";
            }
            ContentValues values=new ContentValues();
            values.put(MediaStore.MediaColumns.DISPLAY_NAME,name);
            values.put(MediaStore.MediaColumns.MIME_TYPE,"image/jpeg");
            values.put(MediaStore.MediaColumns.RELATIVE_PATH,photoDir(reportId,reportName));
            values.put(MediaStore.MediaColumns.IS_PENDING,1);
            entry=resolver.insert(images,values);
            if(entry==null)throw new IOException("Android no creó la copia en Galería.");
            long copied=0;
            try(InputStream src=new BufferedInputStream(new FileInputStream(source));
                OutputStream dst=new BufferedOutputStream(resolver.openOutputStream(entry,"w"))){
                byte[] data=new byte[65536];int n;
                while((n=src.read(data))!=-1){dst.write(data,0,n);copied+=n;}
                dst.flush();
            }
            if(copied!=source.length())throw new IOException("La fotografía copiada está incompleta.");
            // En MediaStore el archivo es nuestro: publicar únicamente tras
            // haber cerrado su descriptor.
            ContentValues done=new ContentValues();
            done.put(MediaStore.MediaColumns.IS_PENDING,0);
            if(resolver.update(entry,done,null,null)<1)
                throw new IOException("No se confirmó la fotografía en Galería.");
            published=true;
            if(actualSize(entry)!=source.length())
                throw new IOException("La copia de Galería no tiene el tamaño correcto.");
            return name;
        }catch(Exception error){
            lastError=error.toString();
            // Borrar solamente una copia incompleta propia de MediaStore
            // para permitir reintentar; nunca borrar el JPG capturado.
            // Si la copia ya es pública, conservarla para rescate.
            if(entry!=null&&!published)
                try{resolver.delete(entry,null,null);}catch(Exception ignored){}
            return "ERROR:"+lastError;
        }
    }
    public synchronized String readCaptureChunk(String photoId,long offset,int maxBytes) {
        if(offset<0||maxBytes<1||maxBytes>192*1024)return "ERROR:Rango incorrecto.";
        File file=getNativeCapture(photoId);
        if(file==null||!file.isFile()||file.length()<1)return "ERROR:Captura no encontrada.";
        try(InputStream in=new BufferedInputStream(new FileInputStream(file))){
            long remaining=offset;
            while(remaining>0){
                long skipped=in.skip(remaining);
                if(skipped<1){if(in.read()==-1)return "ERROR:Lectura incompleta";skipped=1;}
                remaining-=skipped;
            }
            byte[] buf=new byte[maxBytes];int count=0,n;
            while(count<maxBytes&&(n=in.read(buf,count,maxBytes-count))>0)count+=n;
            if(count<1)return "";
            return Base64.encodeToString(buf,0,count,Base64.NO_WRAP);
        }catch(Exception e){lastError=e.toString();return "ERROR:"+lastError;}
    }

    /** Cámara nativa: fotografía original directamente en Galería, no en caché. */
    public synchronized Uri startCamera(String reportId,String reportName,String photoId){
        lastError="";
        try{
            ContentValues cv=new ContentValues();
            cv.put(MediaStore.MediaColumns.DISPLAY_NAME,pictureName(photoId,"jpg"));
            cv.put(MediaStore.MediaColumns.MIME_TYPE,"image/jpeg");
            cv.put(MediaStore.MediaColumns.RELATIVE_PATH,photoDir(reportId,reportName));
            cv.put(MediaStore.MediaColumns.IS_PENDING,1);
            Uri result=resolver.insert(images,cv);
            if(result==null)throw new Exception("No se pudo crear la imagen de cámara.");
            return result;
        }catch(Exception e){lastError=e.toString();return null;}
    }
    public synchronized boolean finishCamera(Uri uri,boolean success){
        if(uri==null)return false;
        try{
            if(success){
                ContentValues done=new ContentValues();
                done.put(MediaStore.MediaColumns.IS_PENDING,0);
                if(resolver.update(uri,done,null,null)<1)
                    throw new Exception("La cámara no confirmó la foto.");
                // La columna SIZE de MediaStore puede tardar en actualizarse.
                // Verificar el archivo real, sin depender de su indexación.
                long size=-1;
                try(android.os.ParcelFileDescriptor fd=resolver.openFileDescriptor(uri,"r")){
                    if(fd!=null)size=fd.getStatSize();
                }
                if(size==0)throw new Exception("La cámara devolvió un archivo vacío.");
                if(size<0){
                    try(InputStream in=resolver.openInputStream(uri)){
                        if(in==null||in.read()==-1)throw new Exception("Fotografía vacía.");
                    }
                }
                return true;
            }
            resolver.delete(uri,null,null);
            return false;
        }catch(Exception e){
            lastError=e.toString();
            // Si hubo foto escrita, intentar dejarla visible para rescate.
            try{ContentValues done=new ContentValues();
                done.put(MediaStore.MediaColumns.IS_PENDING,0);
                resolver.update(uri,done,null,null);
            }catch(Exception ignored){}
            return false;
        }
    }
    private long actualSize(Uri uri){
        try(android.os.ParcelFileDescriptor fd=resolver.openFileDescriptor(uri,"r")){
            if(fd!=null&&fd.getStatSize()>0)return fd.getStatSize();
        }catch(Exception ignored){}
        try(Cursor c=resolver.query(uri,new String[]{MediaStore.MediaColumns.SIZE},null,null,null)){
            if(c!=null&&c.moveToFirst())return c.getLong(0);
        }catch(Exception ignored){}
        return -1;
    }
    public synchronized String beginImage(String reportId,String reportName,String photoId,
                                          String extension,long size) {
        lastError="";
        if(pendingStream!=null)return "ERROR:Ya hay una fotografía en proceso";
        try{
            String name=pictureName(photoId,extension);
            Uri existing=search(images,name,Environment.DIRECTORY_PICTURES+"/SERS Photo/");
            if(existing!=null){
                if(actualSize(existing)==size&&size>0)return "EXISTS";
                return "ERROR:Existe otra copia con distinto tamaño; se mantiene sin sobrescribir.";
            }
            ContentValues values=new ContentValues();
            values.put(MediaStore.MediaColumns.DISPLAY_NAME,name);
            values.put(MediaStore.MediaColumns.MIME_TYPE,mime(ext(extension)));
            values.put(MediaStore.MediaColumns.RELATIVE_PATH,photoDir(reportId,reportName));
            values.put(MediaStore.MediaColumns.IS_PENDING,1);
            Uri uri=resolver.insert(images,values);
            if(uri==null)throw new Exception("No se ha creado la foto en la galería.");
            pendingUri=uri;pendingName=name;pendingExpected=size;pendingWritten=0;
            pendingStream=resolver.openOutputStream(uri,"w");
            if(pendingStream==null)throw new Exception("No se puede escribir la galería.");
            return "READY";
        }catch(Exception e){
            lastError=e.toString();abortImage();
            return "ERROR:"+lastError;
        }
    }
    public synchronized boolean appendImage(String encoded) {
        if(pendingStream==null)return false;
        try{
            byte[] data=Base64.decode(encoded,Base64.DEFAULT);
            pendingStream.write(data);
            pendingWritten+=data.length;
            if(pendingWritten>pendingExpected)throw new Exception("Tamaño de foto incorrecto.");
            return true;
        }catch(Exception e){lastError=e.toString();abortImage();return false;}
    }
    public synchronized String endImage() {
        if(pendingStream==null)return "ERROR:No hay una imagen en curso";
        if(pendingWritten!=pendingExpected){
            lastError="Escritura incompleta: "+pendingWritten+" de "+pendingExpected+" bytes.";
            abortImage();return "ERROR:"+lastError;
        }
        try{
            pendingStream.flush();pendingStream.close();pendingStream=null;
            ContentValues values=new ContentValues();
            values.put(MediaStore.MediaColumns.IS_PENDING,0);
            if(resolver.update(pendingUri,values,null,null)<1)
                throw new Exception("Android no confirmó la fotografía.");
            String name=pendingName;
            pendingUri=null;pendingName=null;pendingWritten=0;
            return name;
        }catch(Exception e){lastError=e.toString();abortImage();return "ERROR:"+lastError;}
    }
    private synchronized void abortImage(){
        try{if(pendingStream!=null)pendingStream.close();}catch(Exception ignored){}
        pendingStream=null;
        // Solo se borra la transferencia incompleta; las fotos confirmadas
        // y cualquier copia externa existente nunca se eliminan.
        if(pendingUri!=null)try{resolver.delete(pendingUri,null,null);}catch(Exception ignored){}
        pendingUri=null;pendingName=null;pendingWritten=0;
    }
    private String createJson(String reportId,String prefix,String data) throws Exception {
        JSONObject j=new JSONObject(data);
        if(!reportId.equals(j.optString("reportId",reportId)))throw new Exception("ID de reportaje incoherente.");
        String stamp=String.valueOf(System.currentTimeMillis())+"_"+Integer.toString(
            (int)(Math.random()*1000000));
        String filename=prefix+"__"+stamp+".json";
        ContentValues values=new ContentValues();
        values.put(MediaStore.MediaColumns.DISPLAY_NAME,filename);
        values.put(MediaStore.MediaColumns.MIME_TYPE,"application/json");
        values.put(MediaStore.MediaColumns.RELATIVE_PATH,dataDir(reportId));
        values.put(MediaStore.MediaColumns.IS_PENDING,1);
        Uri result=resolver.insert(downloads,values);
        if(result==null)throw new Exception("No se ha creado la ficha de seguridad.");
        try{
            byte[] bytes=data.getBytes(StandardCharsets.UTF_8);
            try(OutputStream output=resolver.openOutputStream(result,"w")){
                if(output==null)throw new Exception("No se pudo escribir el JSON.");
                output.write(bytes);output.flush();
            }
            ContentValues completed=new ContentValues();
            completed.put(MediaStore.MediaColumns.IS_PENDING,0);
            if(resolver.update(result,completed,null,null)<1)throw new Exception("Android no confirmó el JSON.");
            return filename;
        }catch(Exception e){
            try{resolver.delete(result,null,null);}catch(Exception ignored){}
            throw e;
        }
    }
    public synchronized String saveReport(String json){
        try{
            JSONObject j=new JSONObject(json);
            if(!"report".equals(j.optString("kind")))throw new Exception("No es un reportaje.");
            return createJson(j.getString("id"),"REPORT",json);
        }catch(Exception e){lastError=e.toString();return "ERROR:"+lastError;}
    }
    public synchronized String savePhotoMeta(String json){
        try{
            JSONObject j=new JSONObject(json);
            if(!"photo".equals(j.optString("kind")))throw new Exception("No es una ficha fotográfica.");
            String id=j.getString("id");
            return createJson(j.getString("reportId"),"PHOTO_"+clean(id),json);
        }catch(Exception e){lastError=e.toString();return "ERROR:"+lastError;}
    }
    /**
     * Copias externas: escanear los JSON legibles del propio paquete. Mantener
     * únicamente la última versión válida de cada id. No tocar las copias.
     */
    public synchronized String readIndex(){
        try{
            Map<String,JSONObject> latestReports=new HashMap<>();
            Map<String,JSONObject> latestPhotos=new HashMap<>();
            final String[] projection={MediaStore.MediaColumns._ID,
                MediaStore.MediaColumns.DISPLAY_NAME,MediaStore.MediaColumns.RELATIVE_PATH};
            try(Cursor c=resolver.query(downloads,projection,
                MediaStore.MediaColumns.RELATIVE_PATH+" LIKE ?",
                new String[]{Environment.DIRECTORY_DOWNLOADS+"/SERS_Photo/%"},
                MediaStore.MediaColumns.DATE_MODIFIED+" DESC")){
                if(c!=null)while(c.moveToNext()){
                    String name=c.getString(1);
                    if(!name.endsWith(".json"))continue;
                    Uri uri=ContentUris.withAppendedId(downloads,c.getLong(0));
                    String value=readSmallJson(uri);
                    if(value==null)continue;
                    try{
                        JSONObject obj=new JSONObject(value);
                        String kind=obj.optString("kind"),id=obj.optString("id");
                        if(id.isEmpty()||!obj.has("reportId")&&!"report".equals(kind))continue;
                        Map<String,JSONObject> target="report".equals(kind)?latestReports:
                            "photo".equals(kind)?latestPhotos:null;
                        if(target==null)continue;
                        JSONObject other=target.get(id);
                        if(other==null||obj.optLong("backupTime",0)>other.optLong("backupTime",0))
                            target.put(id,obj);
                    }catch(Exception ignored){}
                }
            }
            JSONObject result=new JSONObject();
            result.put("reports",new JSONArray(latestReports.values()));
            result.put("photos",new JSONArray(latestPhotos.values()));
            return result.toString();
        }catch(Exception e){lastError=e.toString();return "ERROR:"+lastError;}
    }
    private String readSmallJson(Uri uri){
        try(InputStream in=resolver.openInputStream(uri)){
            if(in==null)return null;
            ByteArrayOutputStream out=new ByteArrayOutputStream();
            byte[] buffer=new byte[4096];int n;
            while((n=in.read(buffer))!=-1){
                out.write(buffer,0,n);
                if(out.size()>128*1024)return null;
            }
            return out.toString("UTF-8");
        }catch(Exception e){return null;}
    }
    public synchronized long imageSize(String filename){
        Uri u=search(images,filename,Environment.DIRECTORY_PICTURES+"/SERS Photo/");
        if(u==null)return -1;
        return actualSize(u);
    }
    public synchronized String readImageChunk(String filename,long offset,int maxBytes){
        if(!filename.startsWith("SERS_")||!filename.matches("[A-Za-z0-9_.-]+"))
            return "ERROR:Nombre de fotografía incorrecto";
        if(offset<0||maxBytes<1||maxBytes>192*1024)return "ERROR:Rango incorrecto";
        Uri u=search(images,filename,Environment.DIRECTORY_PICTURES+"/SERS Photo/");
        if(u==null)return "ERROR:Fotografía no encontrada";
        try(InputStream in=resolver.openInputStream(u)){
            if(in==null)return "ERROR:No se pudo abrir la fotografía";
            long remaining=offset;
            while(remaining>0){
                long skipped=in.skip(remaining);
                if(skipped<=0){
                    if(in.read()==-1)return "ERROR:Fin inesperado";
                    skipped=1;
                }
                remaining-=skipped;
            }
            byte[] buf=new byte[maxBytes];
            int count=0;
            while(count<buf.length){
                int n=in.read(buf,count,buf.length-count);
                if(n<0)break;
                if(n==0)break;
                count+=n;
            }
            if(count<1)return "";
            return Base64.encodeToString(buf,0,count,Base64.NO_WRAP);
        }catch(Exception e){lastError=e.toString();return "ERROR:"+lastError;}
    }
}
