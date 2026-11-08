package com.dullyyj.kids;

import android.Manifest;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.Service;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.content.pm.ServiceInfo;
import android.location.Location;
import android.os.Build;
import android.os.HandlerThread;
import android.os.IBinder;

import com.google.android.gms.location.FusedLocationProviderClient;
import com.google.android.gms.location.LocationCallback;
import com.google.android.gms.location.LocationRequest;
import com.google.android.gms.location.LocationResult;
import com.google.android.gms.location.LocationServices;
import com.google.android.gms.location.Priority;

/** 위치 공유: 앞쪽 서비스 + FusedLocationProvider. 전송 주기는 엔진이 정한다. 위치를 읽는 일은 전부 백그라운드 스레드에서 한다. */
public class LocationService extends Service {
    private FusedLocationProviderClient client;
    private LocationCallback cb;
    private HandlerThread ht;
    private long curIv = 0L;

    @Override
    public IBinder onBind(Intent i) {
        return null;
    }

    @Override
    public int onStartCommand(Intent i, int flags, int startId) {
        Core.init(getApplicationContext());
        NotificationManager nm = getSystemService(NotificationManager.class);
        nm.createNotificationChannel(new NotificationChannel("loc", "위치 공유", NotificationManager.IMPORTANCE_LOW));
        lastWatched = Core.engine.watched();
        Notification n = note(lastWatched);
        try {
            if (Build.VERSION.SDK_INT >= 29) {
                startForeground(11, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION);
            } else {
                startForeground(11, n);
            }
        } catch (Throwable t) {
            // 안드로이드 12+ 는 앱이 뒤에 있을 때(시스템이 서비스를 다시 살릴 때 등) 앞쪽 서비스를 못 켜게 막고, 14+ 는 위치 권한이 없어도 막는다. 앱이 죽지 않게 조용히 멈춘다 — 앱을 열면 다시 켠다.
            stopSelf();
            return START_NOT_STICKY;
        }
        if (cb != null) request();                                  // 이미 돌고 있으면 주기만 새로 건다(부모가 보기 시작했을 때 빠른 주기로)
        else begin();
        return START_STICKY;
    }

    private boolean lastWatched = false;

    /** 상태 표시줄 알림 — 부모님이 보는 동안은 그렇다고 알려 준다. */
    private Notification note(boolean watched) {
        return new Notification.Builder(this, "loc")
                .setSmallIcon(android.R.drawable.ic_menu_mylocation)
                .setContentTitle("길동무 패밀리")
                .setContentText(watched ? "가족이 지금 내 위치를 보고 있어요" : "가족에게 내 위치를 알려주는 중이에요")
                .setOngoing(true)
                .build();
    }

    /** 보는 중인지가 바뀌었으면 알림 글을 바꾼다. */
    private void syncNote() {
        boolean w = Core.engine.watched();
        if (w == lastWatched) return;
        lastWatched = w;
        try {
            getSystemService(NotificationManager.class).notify(11, note(w));
        } catch (Throwable e) {
            // 알림 글을 못 바꿔도 위치 공유는 계속된다
        }
    }

    private void begin() {
        if (cb != null) return;
        if (checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) != PackageManager.PERMISSION_GRANTED) {
            stopSelf();
            return;
        }
        ht = new HandlerThread("kids-loc");
        ht.start();
        client = LocationServices.getFusedLocationProviderClient(this);
        cb = new LocationCallback() {
            @Override
            public void onLocationResult(LocationResult r) {
                Location l = r.getLastLocation();
                if (l == null) return;
                syncNote();
                try {                                                      // 배터리는 읽기만 하고 판단은 서버가 한다(s392)
                    Intent bi = registerReceiver(null, new android.content.IntentFilter(Intent.ACTION_BATTERY_CHANGED));
                    if (bi != null) {
                        int lv = bi.getIntExtra(android.os.BatteryManager.EXTRA_LEVEL, -1), sc = bi.getIntExtra(android.os.BatteryManager.EXTRA_SCALE, 100), st = bi.getIntExtra(android.os.BatteryManager.EXTRA_STATUS, -1);
                        if (lv >= 0 && sc > 0) Core.engine.setBattery(lv * 100 / sc, st == android.os.BatteryManager.BATTERY_STATUS_CHARGING || st == android.os.BatteryManager.BATTERY_STATUS_FULL);
                    }
                } catch (Throwable ignored) {
                    // 배터리를 못 읽어도 위치는 보낸다
                }
                Core.engine.lastFix(l.getLatitude(), l.getLongitude(), l.getAccuracy(), System.currentTimeMillis());
                Net.postLoc(l.getLatitude(), l.getLongitude(), l.getAccuracy(), l.getTime());
                if (Core.engine.locIntervalMs() != curIv) request();      // p-kids53: 움직임이 바뀌면(3분 ↔ 5분) 주기를 새로 건다
            }
        };
        request();
    }

    /** 엔진이 정한 주기로 위치 요청을 (다시) 건다. */
    private void request() {
        if (client == null || cb == null || ht == null) return;
        long iv = Core.engine.locIntervalMs();
        curIv = iv;
        LocationRequest req = new LocationRequest.Builder(Priority.PRIORITY_HIGH_ACCURACY, iv)
                .setMinUpdateIntervalMillis(iv / 2L)
                .build();
        try {
            client.removeLocationUpdates(cb);
            client.requestLocationUpdates(req, cb, ht.getLooper());
        } catch (SecurityException e) {
            stopSelf();
        }
    }

    @Override
    public void onDestroy() {
        try {
            if (client != null && cb != null) client.removeLocationUpdates(cb);
        } catch (Throwable t) {
            // 이미 끝남
        }
        cb = null;
        if (ht != null) ht.quitSafely();
        super.onDestroy();
    }
}
