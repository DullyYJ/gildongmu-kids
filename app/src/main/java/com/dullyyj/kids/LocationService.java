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
        Notification n = new Notification.Builder(this, "loc")
                .setSmallIcon(android.R.drawable.ic_menu_mylocation)
                .setContentTitle("길동무 키즈")
                .setContentText("부모님께 내 위치를 알려주는 중이에요")
                .setOngoing(true)
                .build();
        if (Build.VERSION.SDK_INT >= 29) {
            startForeground(11, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION);
        } else {
            startForeground(11, n);
        }
        begin();
        return START_STICKY;
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
