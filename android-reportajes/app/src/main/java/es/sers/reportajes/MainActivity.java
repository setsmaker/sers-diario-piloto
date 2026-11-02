package es.sers.reportajes;

import android.Manifest;
import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.ContentValues;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.hardware.Sensor;
import android.hardware.SensorEvent;
import android.hardware.SensorEventListener;
import android.hardware.SensorManager;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.os.Handler;
import android.os.Looper;
import android.provider.MediaStore;
import android.speech.RecognizerIntent;
import android.util.Base64;
import android.webkit.GeolocationPermissions;
import android.webkit.JavascriptInterface;
import android.webkit.PermissionRequest;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.webkit.ValueCallback;
import android.widget.Toast;

import androidx.core.content.FileProvider;

import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.util.ArrayList;
import java.util.Locale;

public class MainActivity extends Activity implements SensorEventListener {
    private static final String ORIGIN = "https://setsmaker.github.io";
    private static final String URL = ORIGIN + "/sers-diario-piloto/reportajes/";
    private static final int FILE_REQUEST = 601;
    private static final int VOICE_REQUEST = 602;
    private static final int LOCATION_REQUEST = 603;

    private final Handler ui = new Handler(Looper.getMainLooper());
    private WebView web;
    private ValueCallback<Uri[]> fileCallback;
    private Uri captureUri;
    private SensorManager sensorManager;
    private Sensor rotationSensor;
    private long compassLastSent = 0L;
    private GeolocationPermissions.Callback geoCallback;
    private String geoOrigin;
    private Uri exportUri;
    private OutputStream exportStream;
    private String exportName;

    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        getWindow().setStatusBarColor(0xff24523c);
        getWindow().setNavigationBarColor(0xffffffff);
        sensorManager = (SensorManager) getSystemService(SENSOR_SERVICE);
        if (sensorManager != null) rotationSensor = sensorManager.getDefaultSensor(Sensor.TYPE_ROTATION_VECTOR);

        web = new WebView(this);
        web.setBackgroundColor(0xfff4f7f4);
        setContentView(web);
        WebSettings settings = web.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setDatabaseEnabled(true);
        settings.setGeolocationEnabled(true);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(true);
        settings.setMediaPlaybackRequiresUserGesture(true);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        settings.setCacheMode(WebSettings.LOAD_DEFAULT);

        // Almacén WebView separado de Chrome y de otras APK, incluyendo SERS Diario.
        web.addJavascriptInterface(new NativeBridge(), "SersAndroid");
        web.setWebViewClient(new WebViewClient() {
            @Override public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                Uri uri = request.getUrl();
                if (!"https".equals(uri.getScheme()) || !ORIGIN.equals(uri.getScheme() + "://" + uri.getHost())) return null;
                String path = uri.getPath();
                String asset = null;
                if (path.equals("/sers-diario-piloto/reportajes") ||
                    path.equals("/sers-diario-piloto/reportajes/")) {
                    asset = "web/reportajes/index.html";
                } else if (path.startsWith("/sers-diario-piloto/reportajes/")) {
                    asset = "web/reportajes/" + path.substring("/sers-diario-piloto/reportajes/".length());
                } else if (path.equals("/sers-diario-piloto/zip.js")) {
                    asset = "web/zip.js";
                } else if (path.equals("/sers-diario-piloto/icons/icon-192.png")) {
                    asset = "web/icons/icon-192.png";
                } else if (path.equals("/sers-diario-piloto/icons/icon-512.png")) {
                    asset = "web/icons/icon-512.png";
                }
                if (asset == null || asset.contains("..")) return null;
                try {
                    InputStream stream = getAssets().open(asset);
                    String mime = "text/plain";
                    if (asset.endsWith(".html")) mime = "text/html";
                    else if (asset.endsWith(".js")) mime = "application/javascript";
                    else if (asset.endsWith(".css")) mime = "text/css";
                    else if (asset.endsWith(".webmanifest")) mime = "application/manifest+json";
                    else if (asset.endsWith(".png")) mime = "image/png";
                    return new WebResourceResponse(mime, "UTF-8", stream);
                } catch (Exception ignored) { return null; }
            }
            @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri uri = request.getUrl();
                if (uri.toString().startsWith(URL)) return false;
                String host = uri.getHost();
                if (host != null && (host.equals("login.microsoftonline.com") ||
                    host.endsWith(".microsoftonline.com"))) {
                    toast("Para OneDrive falta configurar el acceso de la APK con Microsoft.");
                    return true;
                }
                if (!request.isForMainFrame()) return false;
                try {
                    startActivity(new Intent(Intent.ACTION_VIEW, uri));
                } catch (Exception ex) { toast("No se pudo abrir el enlace."); }
                return true;
            }
        });
        web.setWebChromeClient(new WebChromeClient() {
            @Override public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback, FileChooserParams params) {
                if (fileCallback != null) fileCallback.onReceiveValue(null);
                fileCallback = callback;
                boolean image = false;
                for (String accept : params.getAcceptTypes()) if (accept.startsWith("image")) image = true;
                try {
                    if (image && params.isCaptureEnabled()) {
                        File directory = new File(getCacheDir(), "camera");
                        if (!directory.exists() && !directory.mkdirs()) throw new IllegalStateException("No se pudo preparar la cámara.");
                        File imageFile = File.createTempFile("sers_reportajes_", ".jpg", directory);
                        captureUri = FileProvider.getUriForFile(MainActivity.this,
                            getPackageName() + ".fileprovider", imageFile);
                        Intent camera = new Intent(MediaStore.ACTION_IMAGE_CAPTURE);
                        camera.putExtra(MediaStore.EXTRA_OUTPUT, captureUri);
                        camera.addFlags(Intent.FLAG_GRANT_WRITE_URI_PERMISSION | Intent.FLAG_GRANT_READ_URI_PERMISSION);
                        startActivityForResult(camera, FILE_REQUEST);
                    } else {
                        captureUri = null;
                        Intent choose = new Intent(Intent.ACTION_GET_CONTENT);
                        choose.addCategory(Intent.CATEGORY_OPENABLE);
                        choose.setType("image/*");
                        startActivityForResult(Intent.createChooser(choose, "Elegir fotografía"), FILE_REQUEST);
                    }
                    return true;
                } catch (Exception error) {
                    fileCallback = null;
                    callback.onReceiveValue(null);
                    toast("No se pudo abrir la cámara o la galería.");
                    return true;
                }
            }
            @Override public void onGeolocationPermissionsShowPrompt(String origin, GeolocationPermissions.Callback callback) {
                if (checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED ||
                    checkSelfPermission(Manifest.permission.ACCESS_COARSE_LOCATION) == PackageManager.PERMISSION_GRANTED) {
                    callback.invoke(origin, true, false);
                } else {
                    geoOrigin = origin; geoCallback = callback;
                    requestPermissions(new String[]{Manifest.permission.ACCESS_FINE_LOCATION,
                        Manifest.permission.ACCESS_COARSE_LOCATION}, LOCATION_REQUEST);
                }
            }
            @Override public void onPermissionRequest(PermissionRequest request) {
                // La grabación de voz se hace mediante reconocedor externo con consentimiento.
                request.deny();
            }
        });
        web.loadUrl(URL);
    }

    @Override protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode == FILE_REQUEST) {
            ValueCallback<Uri[]> callback = fileCallback;
            fileCallback = null;
            if (callback == null) return;
            Uri result = null;
            if (resultCode == RESULT_OK) {
                if (data != null && data.getData() != null) result = data.getData();
                else result = captureUri;
            }
            callback.onReceiveValue(result == null ? null : new Uri[]{result});
            captureUri = null;
        } else if (requestCode == VOICE_REQUEST) {
            if (resultCode == RESULT_OK && data != null) {
                ArrayList<String> words = data.getStringArrayListExtra(RecognizerIntent.EXTRA_RESULTS);
                if (words != null && !words.isEmpty()) {
                    String text = org.json.JSONObject.quote(words.get(0));
                    web.evaluateJavascript("window.dispatchEvent(new CustomEvent('sers-native-dictation',{detail:{text:" + text + "}}));", null);
                }
            }
        }
    }

    @Override public void onRequestPermissionsResult(int code, String[] permissions, int[] results) {
        super.onRequestPermissionsResult(code, permissions, results);
        if (code == LOCATION_REQUEST && geoCallback != null) {
            boolean permitted = false;
            for (int result : results) if (result == PackageManager.PERMISSION_GRANTED) permitted = true;
            geoCallback.invoke(geoOrigin, permitted, false);
            geoCallback = null; geoOrigin = null;
        }
    }

    @Override protected void onResume() {
        super.onResume();
        if (web != null) web.onResume();
        if (sensorManager != null && rotationSensor != null) {
            sensorManager.registerListener(this, rotationSensor, SensorManager.SENSOR_DELAY_UI);
        }
    }
    @Override protected void onPause() {
        if (sensorManager != null) sensorManager.unregisterListener(this);
        if (web != null) web.onPause();
        super.onPause();
    }
    @Override protected void onDestroy() {
        finishExportQuietly();
        if (fileCallback != null) { fileCallback.onReceiveValue(null); fileCallback = null; }
        if (web != null) web.destroy();
        super.onDestroy();
    }
    @Override public void onSensorChanged(SensorEvent event) {
        if (event.sensor.getType() != Sensor.TYPE_ROTATION_VECTOR || web == null) return;
        if (System.currentTimeMillis() - compassLastSent < 750) return;
        float[] matrix = new float[9];
        SensorManager.getRotationMatrixFromVector(matrix, event.values);
        // Eje -Z: dirección óptica aproximada de la cámara trasera.
        // Matriz de rotación Android: X=este, Y=norte, Z=arriba.
        double east = -matrix[2], north = -matrix[5];
        double horizontal = Math.hypot(east, north);
        if (horizontal < 0.35d) return;
        double heading = (Math.toDegrees(Math.atan2(east, north)) + 360d) % 360d;
        if (!Double.isFinite(heading)) return;
        compassLastSent = System.currentTimeMillis();
        double rounded = Math.round(heading * 10.0d) / 10.0d;
        ui.post(() -> {
            if (web != null) web.evaluateJavascript(
                "window.dispatchEvent(new CustomEvent('sers-native-heading',{detail:{degrees:"+
                    rounded+"}}));", null);
        });
    }
    @Override public void onAccuracyChanged(Sensor sensor, int accuracy) { }

    private void toast(String msg) {
        ui.post(() -> Toast.makeText(MainActivity.this, msg, Toast.LENGTH_LONG).show());
    }

    private synchronized void finishExportQuietly() {
        if (exportStream != null) try { exportStream.close(); } catch (Exception ignored) {}
        exportStream = null;
    }

    public class NativeBridge {
        @JavascriptInterface public void startVoiceInput() {
            ui.post(() -> {
                try {
                    Intent voice = new Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH);
                    voice.putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM);
                    voice.putExtra(RecognizerIntent.EXTRA_LANGUAGE, "es-ES");
                    voice.putExtra(RecognizerIntent.EXTRA_PROMPT, "Describe la fotografía");
                    startActivityForResult(voice, VOICE_REQUEST);
                } catch (ActivityNotFoundException e) { toast("No hay un servicio de dictado disponible."); }
            });
        }

        @JavascriptInterface public synchronized void beginZip(String filename) {
            finishExportQuietly();
            exportName = filename.replaceAll("[^a-zA-Z0-9._-]", "_");
            if (!exportName.endsWith(".zip")) exportName += ".zip";
            try {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                    ContentValues values = new ContentValues();
                    values.put(MediaStore.Downloads.DISPLAY_NAME, exportName);
                    values.put(MediaStore.Downloads.MIME_TYPE, "application/zip");
                    values.put(MediaStore.Downloads.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS + "/SERS_Reportajes");
                    values.put(MediaStore.Downloads.IS_PENDING, 1);
                    exportUri = getContentResolver().insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values);
                    if (exportUri == null) throw new IllegalStateException("No se pudo crear archivo.");
                    exportStream = getContentResolver().openOutputStream(exportUri);
                } else {
                    File dir = new File(getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS), "SERS_Reportajes");
                    if (!dir.exists() && !dir.mkdirs()) throw new IllegalStateException("No se pudo crear la carpeta.");
                    exportUri = Uri.fromFile(new File(dir, exportName));
                    exportStream = new FileOutputStream(new File(dir, exportName));
                }
                if (exportStream == null) throw new IllegalStateException("No se pudo abrir el ZIP.");
            } catch (Exception e) {
                finishExportQuietly();
                toast("No se pudo guardar el ZIP: " + e.getMessage());
            }
        }
        @JavascriptInterface public synchronized void appendZipChunk(String base64) {
            if (exportStream == null) return;
            try {
                exportStream.write(Base64.decode(base64, Base64.DEFAULT));
            } catch (Exception e) {
                finishExportQuietly();
                toast("Error al guardar el ZIP.");
            }
        }
        @JavascriptInterface public synchronized void finishZip() {
            try {
                if (exportStream == null) throw new IllegalStateException("Descarga no iniciada.");
                exportStream.flush();finishExportQuietly();
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q && exportUri != null) {
                    ContentValues complete = new ContentValues();
                    complete.put(MediaStore.Downloads.IS_PENDING, 0);
                    getContentResolver().update(exportUri, complete, null, null);
                }
                toast("ZIP guardado en Descargas / SERS_Reportajes");
            } catch (Exception e) { toast("Error cerrando ZIP: " + e.getMessage()); }
        }
    }

    @Override public void onBackPressed() {
        if (web != null && web.canGoBack()) web.goBack();
        else super.onBackPressed();
    }
}
