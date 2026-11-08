package com.dullyyj.kids;

import android.Manifest;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.location.Location;

import com.google.android.gms.location.CurrentLocationRequest;
import com.google.android.gms.location.FusedLocationProviderClient;
import com.google.android.gms.location.LocationServices;
import com.google.android.gms.location.Priority;
import com.google.android.gms.tasks.CancellationTokenSource;
import com.google.android.gms.tasks.OnSuccessListener;

/**
 * 부모가 처음 열었는데 가족구성원 위치가 없을 때 서버(엔진)가 보내는 '위치 한 번 올려' 푸시(k=locreq)를 처리한다.
 * 무엇을 언제 요청할지는 서버가 정한다. 여기는 위치 한 번을 읽어 엔진에 넘길 뿐이다(엔진이 부모에게 올린다).
 * 위치 공유를 껐거나 동의·권한이 없으면 아무것도 하지 않는다.
 */
final class LocReq {
    private LocReq() {}

    /** 부모가 가족 화면을 보기 시작했다는 푸시(k=watch): 빠른 보고 주기로 바꾸고(서비스를 다시 걸어 주기를 새로 정하게 한다) 위치를 한 번 바로 올린다. 이후는 서버 응답이 정한다. */
    static void watch(final Context c) {
        try {
            if (c == null || Core.engine == null || !Core.engine.locOn()) return;
            Core.engine.watchOn();
            once(c);
        } catch (Throwable t) {
            // 푸시 하나를 못 처리해도 앱은 계속 쓴다
        }
    }

    static void once(final Context c) {
        try {
            if (c == null || Core.engine == null || !Core.engine.locOn()) return;
            if (c.checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) != PackageManager.PERMISSION_GRANTED) return;
            Core.engine.locAsk();                                  // 방금 잡은 위치가 있으면 곧바로 올리고, 없으면 다음 위치를 바로 올리게 표시
            try {
                c.startForegroundService(new Intent(c, LocationService.class));     // 앱이 꺼져 있었다면 위치 서비스도 다시 켠다(푸시로 깨어난 직후엔 허용된다)
            } catch (Throwable t) {
                // 서비스를 못 켜도 아래 한 번 읽기는 한다
            }
            final FusedLocationProviderClient cl = LocationServices.getFusedLocationProviderClient(c);
            CurrentLocationRequest rq = new CurrentLocationRequest.Builder()
                    .setPriority(Priority.PRIORITY_HIGH_ACCURACY)
                    .setMaxUpdateAgeMillis(60000L)
                    .setDurationMillis(12000L)
                    .build();
            cl.getCurrentLocation(rq, new CancellationTokenSource().getToken()).addOnSuccessListener(new OnSuccessListener<Location>() {
                @Override
                public void onSuccess(Location l) {
                    if (l != null) {
                        Core.engine.lastFix(l.getLatitude(), l.getLongitude(), l.getAccuracy(), System.currentTimeMillis());
                        return;
                    }
                    try {
                        cl.getLastLocation().addOnSuccessListener(new OnSuccessListener<Location>() {
                            @Override
                            public void onSuccess(Location l2) {
                                if (l2 != null) Core.engine.lastFix(l2.getLatitude(), l2.getLongitude(), l2.getAccuracy(), System.currentTimeMillis());
                            }
                        });
                    } catch (Throwable t) {
                        // 위치를 못 잡으면 위치 서비스의 다음 주기에 올라간다
                    }
                }
            });
        } catch (Throwable t) {
            // 푸시 하나를 못 처리해도 앱은 계속 쓴다
        }
    }
}
