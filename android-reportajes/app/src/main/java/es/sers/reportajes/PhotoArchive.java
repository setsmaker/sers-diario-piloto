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
    private final Uri images = MediaStore.Images.Media.EXTERNAL_CONTENT_URI;
    private final Uri downloads = MediaStore.Downloads.EXTERNAL_CONTENT_URI;
    private Uri pendingUri;
    private OutputStream pendingStream;
    private long pendingExpected, pendingWritten;
    private String pendingName;
    private String lastError = "";

    public PhotoArchive(Context context) { resolver=context.getContentResolver(); }

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
    public synchronized String beginImage(String reportId,String reportName,String photoId,
                                          String extension,long size) {
        lastError="";
        if(pendingStream!=null)return "ERROR:Ya hay una fotografía en proceso";
        try{
            String name=pictureName(photoId,extension);
            Uri existing=search(images,name,Environment.DIRECTORY_PICTURES+"/SERS Photo/");
            if(existing!=null){
                try(Cursor c=resolver.query(existing,
                    new String[]{MediaStore.MediaColumns.SIZE},null,null,null)){
                    if(c!=null&&c.moveToFirst()&&c.getLong(0)==size&&size>0)return "EXISTS";
                }
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
        Uri u=search(images,clean(filename.replace(".","_").replace("_jpg",".jpg")),
            Environment.DIRECTORY_PICTURES+"/SERS Photo/");
        // La limpieza anterior no es apta para nombres completos; utilizar
        // consulta exacta en su lugar.
        u=search(images,filename,Environment.DIRECTORY_PICTURES+"/SERS Photo/");
        if(u==null)return -1;
        try(Cursor c=resolver.query(u,new String[]{MediaStore.MediaColumns.SIZE},null,null,null)){
            return c!=null&&c.moveToFirst()?c.getLong(0):-1;
        }catch(Exception ignored){return -1;}
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
            int count=in.read(buf,0,buf.length);
            if(count<0)return "";
            return Base64.encodeToString(buf,0,count,Base64.NO_WRAP);
        }catch(Exception e){lastError=e.toString();return "ERROR:"+lastError;}
    }
}
