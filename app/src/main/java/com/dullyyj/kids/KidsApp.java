package com.dullyyj.kids;

import android.app.Application;

public class KidsApp extends Application {
    @Override
    public void onCreate() {
        super.onCreate();
        Core.init(this);
        Push.app = getApplicationContext();
        com.dullyyj.subway.SceneCore.quietAuto = true; // 길동무 친구들이 스스로 놀 때의 진동은 끈다(손으로 잡고 놓는 진동만 남는다)
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
