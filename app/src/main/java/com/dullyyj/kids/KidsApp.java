package com.dullyyj.kids;

import android.app.Application;

public class KidsApp extends Application {
    @Override
    public void onCreate() {
        super.onCreate();
        Core.init(this);
        Push.app = getApplicationContext();
        final android.content.Context app = this;
        Thread th = new Thread(new Runnable() {
            @Override
            public void run() {
                com.dullyyj.subway.ScreenView.preloadFaces(app);
            }
        });
        th.setDaemon(true);
        th.start();
    }
}
