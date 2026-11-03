package com.dullyyj.kids;

import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Notification;
import android.content.Context;
import android.content.Intent;
import android.os.Build;

import com.google.android.gms.tasks.OnSuccessListener;
import com.google.firebase.messaging.FirebaseMessaging;
import com.google.firebase.messaging.FirebaseMessagingService;
import com.google.firebase.messaging.RemoteMessage;

import org.json.JSONObject;

import java.util.Map;

/**
 * 푸시(FCM) — 앱이 꺼져 있거나 뒤에 있어도 부모님 말 · 장소 출발 시간 · 미션 알림이 온다.
 * 무엇을 언제 보낼지는 전부 서버(엔진)가 정한다. 앱은 토큰을 서버에 맡기고, 받은 글(title · body)을 알림으로 보여 줄 뿐이다.
 * 앱이 앞에 떠 있으면 실시간 대기가 이미 화면을 갱신하므로 알림은 띄우지 않는다.
 */
public class Push extends FirebaseMessagingService {
    static volatile Context app;
    static volatile boolean fg = false;
    private static boolean started = false;
    private static final String CH = "kids_alert2", CH_OLD = "kids_push";

    /** 엔진이 1초마다 부른다 — 동의한 뒤 한 번만 토큰을 받아 서버에 올린다(Firebase 설정 파일이 없는 빌드에서는 조용히 건너뛴다). */
    static void ping(boolean consented) {
        if (!consented || app == null || started) return;
        started = true;
        Wire.EX.execute(new Runnable() {
            @Override
            public void run() {
                try {
                    FirebaseMessaging.getInstance().getToken().addOnSuccessListener(new OnSuccessListener<String>() {
                        @Override
                        public void onSuccess(String tk) {
                            upload(tk);
                        }
                    });
                } catch (Throwable t) {
                    started = false; // 다음에 다시 시도
                }
            }
        });
    }

    /** 토큰을 서버(D1 devices)에 매핑한다. 같은 토큰을 이미 올렸으면 다시 보내지 않는다. */
    static void upload(final String tk) {
        if (tk == null || tk.length() < 20 || Core.store == null || Core.engine == null) return;
        Wire.EX.execute(new Runnable() {
            @Override
            public void run() {
                try {
                    if (tk.equals(Core.store.get("ft.up", ""))) return;
                    String id = Core.engine.childId(), sec = Core.engine.childSecret();
                    JSONObject r = new JSONObject();
                    r.put("id", id);
                    r.put("sec", sec);
                    r.put("role", "c");
                    Kid.call("POST", "/reg", r.toString(), null, null);
                    JSONObject b = new JSONObject();
                    b.put("tk", tk);
                    String res = Kid.call("POST", "/c/ft", b.toString(), id, sec);
                    if (res != null && new JSONObject(res).optBoolean("ok", false)) Core.store.put("ft.up", tk);
                } catch (Throwable t) {
                    // 다음 실행 때 다시 올린다
                }
            }
        });
    }

    @Override
    public void onNewToken(String tk) {
        try {
            Core.init(getApplicationContext());
            if (Core.engine.consented()) upload(tk);
        } catch (Throwable t) {
            // 무시
        }
    }

    @Override
    public void onMessageReceived(RemoteMessage m) {
        try {
            Core.init(getApplicationContext());
            if (!Core.engine.consented()) return;
            Map<String, String> d = m.getData();
            if (d == null) return;
            if ("watch".equals(d.get("k"))) {                     // 부모가 키즈 화면을 보기 시작했다 — 위치를 빨리(서버가 정한 주기로) 올린다 · 알림은 띄우지 않는다
                LocReq.watch(getApplicationContext());
                return;
            }
            if ("locreq".equals(d.get("k"))) {                    // 서버가 '위치 한 번 올려' 를 요청했다(부모가 처음 열었는데 위치가 없을 때) — 알림은 띄우지 않는다
                LocReq.once(getApplicationContext());
                return;
            }
            String title = d.get("title"), body = d.get("body"), tag = d.get("tag");
            if (body == null || body.isEmpty()) return;
            if (fg && "chat".equals(Core.engine.tab())) { cue(getApplicationContext()); return; } // 대화 탭을 보고 있을 때만 알림 카드를 숨긴다(다른 탭이면 카톡처럼 알림이 온다) — 대신 진동 + 알림음은 낸다
            show(this, title == null || title.isEmpty() ? "길동무 키즈" : title, body, tag == null ? "k" : tag);
        } catch (Throwable t) {
            // 알림 하나를 못 띄워도 앱은 계속 쓴다
        }
    }

    /** 알림 카드를 숨기는 때(대화 탭을 보는 중)에도 진동 + 알림음은 낸다. 소리는 기기의 알림 음량 · 무음 설정을 따른다. */
    static void cue(Context c) {
        try {
            android.os.Vibrator v = (android.os.Vibrator) c.getSystemService(Context.VIBRATOR_SERVICE);
            if (v != null && v.hasVibrator()) {
                long[] pat = {0, 300, 150, 300};
                if (Build.VERSION.SDK_INT >= 26) v.vibrate(android.os.VibrationEffect.createWaveform(pat, -1)); else v.vibrate(pat, -1);
            }
        } catch (Throwable t) {
            // 진동을 못 내도 계속
        }
        try {
            android.media.Ringtone r = android.media.RingtoneManager.getRingtone(c, android.provider.Settings.System.DEFAULT_NOTIFICATION_URI);
            if (r != null) {
                if (Build.VERSION.SDK_INT >= 28) r.setAudioAttributes(new android.media.AudioAttributes.Builder().setUsage(android.media.AudioAttributes.USAGE_NOTIFICATION).setContentType(android.media.AudioAttributes.CONTENT_TYPE_SONIFICATION).build());
                r.play();
            }
        } catch (Throwable t) {
            // 소리를 못 내도 계속
        }
    }

    static void show(Context c, String title, String body, String tag) {
        NotificationManager nm = (NotificationManager) c.getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm == null) return;
        if (Build.VERSION.SDK_INT >= 26 && nm.getNotificationChannel(CH) == null) {
            try { nm.deleteNotificationChannel(CH_OLD); } catch (Throwable ignored) { } // 옛 채널은 설정을 바꿀 수 없어 새 채널로 갈아탄다
            NotificationChannel ch = new NotificationChannel(CH, "길동무 키즈 알림", NotificationManager.IMPORTANCE_HIGH);
            ch.enableVibration(true);
            ch.enableLights(true);
            ch.setLockscreenVisibility(Notification.VISIBILITY_PUBLIC);
            ch.setVibrationPattern(new long[] {0, 300, 150, 300, 150, 300});
            ch.setSound(android.provider.Settings.System.DEFAULT_NOTIFICATION_URI, new android.media.AudioAttributes.Builder()
                    .setUsage(android.media.AudioAttributes.USAGE_NOTIFICATION).setContentType(android.media.AudioAttributes.CONTENT_TYPE_SONIFICATION).build());
            nm.createNotificationChannel(ch);
        }
        Intent it = new Intent(c, MainActivity.class);
        it.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        PendingIntent pi = PendingIntent.getActivity(c, 0, it, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        Notification.Builder nb = Build.VERSION.SDK_INT >= 26 ? new Notification.Builder(c, CH) : new Notification.Builder(c);
        nb.setSmallIcon(c.getApplicationInfo().icon).setContentTitle(title).setContentText(body)
                .setStyle(new Notification.BigTextStyle().bigText(body)).setAutoCancel(true).setContentIntent(pi).setVisibility(Notification.VISIBILITY_PUBLIC);
        if (Build.VERSION.SDK_INT < 26) nb.setPriority(Notification.PRIORITY_HIGH).setDefaults(Notification.DEFAULT_ALL);
        nm.notify(tag, 1, nb.build());
    }
}
