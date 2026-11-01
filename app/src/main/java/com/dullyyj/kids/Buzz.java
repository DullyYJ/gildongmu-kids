package com.dullyyj.kids;

import android.content.Context;
import android.os.Build;
import android.os.VibrationEffect;
import android.os.Vibrator;
import android.os.VibratorManager;

import com.dullyyj.subway.SceneHaptics;

/**
 * 길동무와 같은 진동 무늬표(SceneHaptics)로 짧게 울린다. 무늬는 길동무와 한 벌이라 캐릭터마다 느낌이 같다.
 * 실제 기기에서 빠지지 않게: 진동기를 매번 새로 얻고(31+는 VibratorManager) · 세기 조절이 없는 기기는 세기 없이 · 무늬가 거부되면 짧은 진동으로 대신한다.
 */
final class Buzz {
    private Buzz() {
    }

    /** 캐릭터마다 다른 착지 느낌 이름(길동무의 landK 와 같은 짝). */
    static String landOf(String id) {
        if ("dolsom".equals(id)) return "land_cotton";
        if ("ppopu".equals(id)) return "land_pose";
        if ("dudung".equals(id)) return "land_dig";
        if ("lovel".equals(id)) return "land_flip";
        if ("sul".equals(id)) return "land_fly";
        if ("chaeng".equals(id)) return "land_puddle";
        return "land";
    }

    private static Vibrator vibrator(Context c) {
        try {
            Context a = c.getApplicationContext() == null ? c : c.getApplicationContext();
            if (Build.VERSION.SDK_INT >= 31) {
                VibratorManager vm = (VibratorManager) a.getSystemService(Context.VIBRATOR_MANAGER_SERVICE);
                if (vm != null) {
                    Vibrator v = vm.getDefaultVibrator();
                    if (v != null) return v;
                }
            }
            return (Vibrator) a.getSystemService(Context.VIBRATOR_SERVICE);
        } catch (RuntimeException e) {
            return null;
        }
    }

    static void play(Context c, String name) {
        if (c == null) return;
        SceneHaptics.Pat p = null;
        try {
            p = SceneHaptics.get(name);
        } catch (RuntimeException e) {
            p = null;
        }
        if (p == null || p.timings == null || p.timings.length == 0) return;
        Vibrator v = vibrator(c);
        if (v == null) return;
        try {
            if (!v.hasVibrator()) return;
        } catch (RuntimeException e) {
            // 알 수 없으면 그대로 시도한다
        }
        try {
            if (Build.VERSION.SDK_INT >= 26) {
                long[] t = p.timings;
                boolean amp = false;
                try {
                    amp = v.hasAmplitudeControl() && p.amps != null && p.amps.length == t.length;
                } catch (RuntimeException e) {
                    amp = false;
                }
                if (amp) {
                    int[] a = new int[t.length];
                    for (int i = 0; i < a.length; i++) a[i] = Math.max(0, Math.min(255, p.amps[i]));
                    v.vibrate(VibrationEffect.createWaveform(t, a, -1));
                } else {
                    v.vibrate(VibrationEffect.createWaveform(t, -1));
                }
            } else {
                v.vibrate(p.timings, -1);
            }
            return;
        } catch (RuntimeException e) {
            // 무늬를 못 쓰는 기기 — 아래에서 짧은 진동으로 대신한다
        }
        try {
            if (Build.VERSION.SDK_INT >= 26) v.vibrate(VibrationEffect.createOneShot(40L, VibrationEffect.DEFAULT_AMPLITUDE));
            else v.vibrate(40L);
        } catch (RuntimeException e) {
            // 진동 문제는 화면에 영향 없다
        }
    }
}
