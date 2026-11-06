package org.openscoreai.app;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(android.os.Bundle savedInstanceState) {
        registerPlugin(ScoreDocumentsPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
