package com.dullyyj.kids;

import android.content.Context;
import android.os.Build;
import android.os.VibrationEffect;
import android.os.Vibrator;

import com.dullyyj.subway.SceneHaptics;

/** 길동무와 같은 진동 무늬표(SceneHaptics)로 짧게 울린다. 무늬는 길동무와 한 벌이라 캐릭터마다 느낌이 같다. */
final class Buzz {
    private static Vibrator vib;

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

    static void play(Context c, String name) {
        SceneHaptics.Pat p = SceneHaptics.get(name);
        if (p == null || c == null) return;
        try {
            if (vib == null) vib = (Vibrator) c.getApplicationContext().getSystemService(Context.VIBRATOR_SERVICE);
            if (vib == null || !vib.hasVibrator()) return;
            if (Build.VERSION.SDK_INT >= 26) vib.vibrate(VibrationEffect.createWaveform(p.timings, p.amps, -1));
            else vib.vibrate(p.timings, -1);
        } catch (RuntimeException e) {
            // 진동 문제는 화면에 영향 없다
        }
    }
}
