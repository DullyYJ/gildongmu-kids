package com.dullyyj.kids;

import android.Manifest;
import android.app.Activity;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.HandlerThread;
import android.os.Looper;
import android.view.View;
import android.view.ViewGroup;
import android.view.Window;
import android.view.WindowManager;
import android.widget.LinearLayout;

import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsControllerCompat;

import org.json.JSONObject;

import java.util.ArrayList;

/**
 * 껍데기 — 엔진이 1초마다 판단한 결과(화면 JSON)를 받아 그리고, 눌림을 엔진에 넘기기만 한다.
 * 엔진 일은 전용 스레드("kids-engine")에서 하고, 메인 스레드는 그리기만 한다.
 */
public class MainActivity extends Activity {
    private static final int REQ_PERM = 7;

    private final Handler ui = new Handler(Looper.getMainLooper());
    private HandlerThread ht;
    private Handler eh;
    private Renderer renderer;
    private TabBar tabbar;
    private LinearLayout root;
    private boolean running = false;
    // 아래 셋은 엔진 스레드에서만 쓴다
    private int lastRev = -1;
    private String lastTab = "";
    private String lastTheme = "";

    private final Runnable loop = new Runnable() {
        @Override
        public void run() {
            if (!running) return;
            step();
            eh.postDelayed(this, 1000L);
        }
    };

    @Override
    protected void onCreate(Bundle b) {
        super.onCreate(b);
        Core.init(getApplicationContext());
        getWindow().setSoftInputMode(WindowManager.LayoutParams.SOFT_INPUT_ADJUST_RESIZE);
        ht = new HandlerThread("kids-engine");
        ht.start();
        eh = new Handler(ht.getLooper());

        renderer = new Renderer(this, new Renderer.Cb() {
            @Override
            public void call(String v, String arg) {
                act(v, arg);
            }
        });
        renderer.setRefresh(new Runnable() {
            @Override
            public void run() {
                eh.post(new Runnable() {
                    @Override
                    public void run() {
                        lastRev = -1;
                        step();
                    }
                });
            }
        });
        tabbar = new TabBar(this);
        root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.addView(renderer.view(), new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f));
        root.addView(tabbar, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));
        setContentView(root);
    }

    @Override
    protected void onResume() {
        super.onResume();
        if (!running) {
            running = true;
            eh.post(new Runnable() {
                @Override
                public void run() {
                    lastRev = -1;
                }
            });
            eh.post(loop);
        }
        if (Core.engine.locOn() && hasLocPerm()) startLoc();
    }

    @Override
    protected void onPause() {
        running = false;
        eh.removeCallbacks(loop);
        super.onPause();
    }

    @Override
    protected void onDestroy() {
        running = false;
        if (renderer != null) renderer.destroy();
        if (ht != null) ht.quitSafely();
        super.onDestroy();
    }

    @Override
    public void onBackPressed() {
        if (Core.engine.consented() && !"home".equals(Core.engine.tab())) {
            act("tab.home", "");
        } else {
            super.onBackPressed();
        }
    }

    // ───────── 엔진 ↔ 화면 ─────────
    /** 엔진 스레드에서: 한 틱 돌리고, 바뀐 게 있으면 새 화면을 그리게 넘긴다. */
    private void step() {
        Engine en = Core.engine;
        en.tick(System.currentTimeMillis());
        final String theme = en.theme();
        final String tab = en.tab();
        int rev = en.rev();
        final String vil = en.village();
        if (rev != lastRev || !tab.equals(lastTab) || !theme.equals(lastTheme)) {
            lastRev = rev;
            lastTab = tab;
            lastTheme = theme;
            final String scr = en.screen(tab);
            final String bar = en.tabbar(tab);
            ui.post(new Runnable() {
                @Override
                public void run() {
                    show(theme, scr, bar, vil);
                }
            });
        } else {
            ui.post(new Runnable() {
                @Override
                public void run() {
                    renderer.village(vil);
                }
            });
        }
    }

    private void show(String theme, String scr, String bar, String vil) {
        Pal.set(theme);
        applyBars();
        root.setBackgroundColor(Pal.c(Pal.BG));
        renderer.build(scr);
        renderer.village(vil);
        tabbar.set(bar, new TabBar.Cb() {
            @Override
            public void tab(String id) {
                act("tab." + id, "");
            }
        });
        tabbar.setVisibility(tabbar.count() > 0 ? View.VISIBLE : View.GONE);
    }

    private void applyBars() {
        Window w = getWindow();
        w.setStatusBarColor(Pal.c(Pal.BG));
        w.setNavigationBarColor(Pal.c(Pal.NAV));
        WindowInsetsControllerCompat ic = WindowCompat.getInsetsController(w, w.getDecorView());
        ic.setAppearanceLightStatusBars(!Pal.dark);
        ic.setAppearanceLightNavigationBars(!Pal.dark);
    }

    /** 눌림은 그대로 엔진에 넘긴다. 결과로 나온 명령(위치 권한·시작·멈춤)만 여기서 한다. */
    private void act(final String v, final String arg) {
        eh.post(new Runnable() {
            @Override
            public void run() {
                String res = Core.engine.call(v, arg, System.currentTimeMillis());
                handle(res);
                step();
            }
        });
    }

    private void handle(String res) {
        if (res == null || res.isEmpty()) return;
        String cmd = "";
        try {
            cmd = new JSONObject(res).optString("cmd");
        } catch (Exception e) {
            cmd = "";
        }
        if ("perm".equals(cmd)) {
            ui.post(new Runnable() {
                @Override
                public void run() {
                    askPerms();
                }
            });
        } else if ("loc.start".equals(cmd)) {
            ui.post(new Runnable() {
                @Override
                public void run() {
                    startLoc();
                }
            });
        } else if ("loc.stop".equals(cmd)) {
            ui.post(new Runnable() {
                @Override
                public void run() {
                    stopLoc();
                }
            });
        }
    }

    // ───────── 위치 권한·서비스 ─────────
    private boolean hasLocPerm() {
        return checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED;
    }

    private void askPerms() {
        ArrayList<String> need = new ArrayList<String>();
        if (!hasLocPerm()) {
            need.add(Manifest.permission.ACCESS_FINE_LOCATION);
            need.add(Manifest.permission.ACCESS_COARSE_LOCATION);
        }
        if (Build.VERSION.SDK_INT >= 33
                && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
            need.add(Manifest.permission.POST_NOTIFICATIONS);
        }
        if (need.isEmpty()) {
            if (Core.engine.locOn()) startLoc();
            return;
        }
        requestPermissions(need.toArray(new String[0]), REQ_PERM);
    }

    @Override
    public void onRequestPermissionsResult(int code, String[] perms, int[] results) {
        super.onRequestPermissionsResult(code, perms, results);
        if (code != REQ_PERM) return;
        if (hasLocPerm()) {
            if (Core.engine.locOn()) startLoc();
        } else {
            act("loc.denied", "");
        }
    }

    private void startLoc() {
        if (!hasLocPerm()) return;
        try {
            startForegroundService(new Intent(this, LocationService.class));
        } catch (Throwable t) {
            // 서비스를 못 켜도 앱은 계속 쓴다
        }
    }

    private void stopLoc() {
        stopService(new Intent(this, LocationService.class));
    }
}
