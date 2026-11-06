package org.openscoreai.app;

import android.app.Activity;
import android.content.Intent;
import android.util.Base64;
import androidx.activity.result.ActivityResult;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.OutputStream;

/** System document chooser exports to Downloads, Drive or another user-selected
 * document provider without broad filesystem access or WebView blob downloads. */
@CapacitorPlugin(name = "ScoreDocuments")
public class ScoreDocumentsPlugin extends Plugin {
    @PluginMethod
    public void saveFile(PluginCall call) {
        String name = call.getString("name");
        String data = call.getString("data");
        if (name == null || name.contains("/") || name.contains("\\") || data == null || data.length() > 40000000) {
            call.reject("Invalid export name or file is too large");
            return;
        }
        Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT);
        intent.addCategory(Intent.CATEGORY_OPENABLE);
        intent.setType(call.getString("mime", "application/octet-stream"));
        intent.putExtra(Intent.EXTRA_TITLE, name);
        startActivityForResult(call, intent, "documentCreated");
    }

    @ActivityCallback
    private void documentCreated(PluginCall call, ActivityResult result) {
        if (call == null) return;
        if (result.getResultCode() != Activity.RESULT_OK || result.getData() == null || result.getData().getData() == null) {
            call.reject("Save cancelled");
            return;
        }
        final android.net.Uri uri = result.getData().getData();
        getBridge().execute(() -> {
            try (OutputStream out = getContext().getContentResolver().openOutputStream(uri, "wt")) {
                if (out == null) throw new IllegalStateException("Document provider is not writable");
                out.write(Base64.decode(call.getString("data"), Base64.DEFAULT));
                out.flush();
                JSObject response = new JSObject();
                response.put("uri", uri.toString());
                call.resolve(response);
            } catch (Exception error) {
                call.reject("Could not save export", error);
            }
        });
    }
}
