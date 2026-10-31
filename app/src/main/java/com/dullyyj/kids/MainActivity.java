package com.dullyyj.kids;

import android.Manifest;
import android.app.Activity;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.location.Location;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.HandlerThread;
import android.os.Looper;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.view.Window;
import android.view.WindowInsets;
import android.view.WindowManager;
import android.widget.FrameLayout;
import android.widget.LinearLayout;

import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsControllerCompat;

import com.google.android.gms.location.FusedLocationProviderClient;
import com.google.android.gms.location.LocationServices;
import com.google.android.gms.location.Priority;
import com.google.android.gms.tasks.CancellationTokenSource;
import com.google.android.gms.tasks.OnSuccessListener;

import com.dullyyj.subway.ScreenCore;
import com.dullyyj.subway.ScreenView;

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
    private ScreenView hdrView;
    private LinearLayout root;
    private boolean running = false;
    // 아래 셋은 엔진 스레드에서만 쓴다
    private int lastRev = -1;
    private String lastTab = "";
    private String lastTheme = "";
    private String lastHdr = "";
    private String lastSheet = "";
    private long lastQuick = 0L;

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
        // 장면에서 공부 중인 친구를 건드리면 엔진에 알린다(화내는 동작은 장면이 바로 그린다)
        Poke.setSink(new Poke.Sink() {
            @Override
            public void angry(final String id) {
                eh.post(new Runnable() {
                    @Override
                    public void run() {
                        Core.engine.angered(id, System.currentTimeMillis());
                        step();
                    }
                });
            }

            @Override
            public void pick(String id, String what) {
                act("kid.pick:" + id + ":" + what, "");
            }
        });
        tabbar = new TabBar(this);
        root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        // 맨 위 흐르는 응원 문구(길동무와 같은 그리개 · 높이 43dp)
        hdrView = SvHost.make(this, null);
        hdrView.setVisibility(View.GONE);
        root.addView(hdrView, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, Math.round(35f * getResources().getDisplayMetrics().density)));
        root.addView(renderer.view(), new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f));
        root.addView(tabbar, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, Math.round(56f * getResources().getDisplayMetrics().density)));
        // 상태 표시줄 · 내비게이션 막대 자리를 비우고, 상태 표시줄 자리는 길동무처럼 늘 검정으로 채운다
        final FrameLayout outer = new FrameLayout(this);
        outer.setBackgroundColor(0xFF000000);
        final View sbStrip = new View(this);
        sbStrip.setBackgroundColor(0xFF000000);
        outer.addView(root, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        outer.addView(sbStrip, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, Gravity.TOP));
        outer.setOnApplyWindowInsetsListener(new View.OnApplyWindowInsetsListener() {
            @Override
            public WindowInsets onApplyWindowInsets(View v, WindowInsets in) {
                root.setPadding(in.getSystemWindowInsetLeft(), in.getSystemWindowInsetTop(), in.getSystemWindowInsetRight(), in.getSystemWindowInsetBottom());
                ViewGroup.LayoutParams lp = sbStrip.getLayoutParams();
                if (lp.height != in.getSystemWindowInsetTop()) {
                    lp.height = in.getSystemWindowInsetTop();
                    sbStrip.setLayoutParams(lp);
                }
                return in;
            }
        });
        setContentView(outer);
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
        quickFix();
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
        Poke.setSink(null);
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
        long nowT = System.currentTimeMillis();
        en.tick(nowT);
        android.util.DisplayMetrics dm = getResources().getDisplayMetrics();
        en.setView(Math.round(renderer.view().getHeight() / dm.density));
        askScene(en, nowT);
        askDong(en, nowT);
        final String theme = en.theme();
        final String tab = en.tab();
        int rev = en.rev();
        final String vil = en.village();
        final boolean cons = en.consented();
        final String hd = en.hdr();
        if (!hd.equals(lastHdr)) {
            lastHdr = hd;
            final ScreenCore.Screen hs = SvHost.parse(hd);
            ui.post(new Runnable() {
                @Override
                public void run() {
                    hdrShow(hs, theme);
                }
            });
        }
        if (rev != lastRev || !tab.equals(lastTab) || !theme.equals(lastTheme)) {
            lastRev = rev;
            lastTab = tab;
            lastTheme = theme;
            final String scr = en.screen(tab);
            final String bar = en.tabbar(tab);
            final ScreenCore.Screen pre = !cons || "home".equals(tab) ? SvHost.parse(scr) : null;
            ui.post(new Runnable() {
                @Override
                public void run() {
                    show(theme, scr, bar, vil, pre);
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
        // 처음 켰을 때의 동의 창은 홈 화면 위로 올라온다(동의하면 내려간다)
        final String sheet = cons ? en.dressSheet() : en.consentSheet();
        if (!sheet.equals(lastSheet)) {
            lastSheet = sheet;
            ui.post(new Runnable() {
                @Override
                public void run() {
                    renderer.consent(sheet, cons);
                }
            });
        }
    }

    /** 장면(해변 친구들)과 날씨는 길동무 서버가 정한 값을 받아 올 뿐이다 — 뒤 스레드에서 받아 엔진에 넘긴다. */
    private void askScene(Engine en, long now) {
        if (!en.sceneDue(now)) return;
        en.sceneAsked(now);
        final String body = en.sceneBody(now);
        Wire.EX.execute(new Runnable() {
            @Override
            public void run() {
                String r = Wire.post("/scene", body, 8000);
                if (r != null) Core.engine.setScene(r, System.currentTimeMillis());
            }
        });
    }

    /** 동네 이름은 길동무 서버에 좌표를 보내 받아 온다 — 뒤 스레드에서 받아 엔진에 넘길 뿐이다. */
    private void askDong(final Engine en, long now) {
        if (!en.dongDue(now)) return;
        en.dongAsked(now);
        final double[] w = en.where();
        final String url = en.dongUrl();
        if (w == null || url.isEmpty()) return;
        Wire.EX.execute(new Runnable() {
            @Override
            public void run() {
                String r = Wire.get(url, 6000);
                if (r != null) Core.engine.setDong(r, w[0], w[1]);
            }
        });
    }

    private void hdrShow(ScreenCore.Screen hs, String theme) {
        if (hs == null) {
            hdrView.setVisibility(View.GONE);
            return;
        }
        hdrView.setPalette(SvHost.palette(theme));
        hdrView.setScreen(hs, true);
        hdrView.setVisibility(View.VISIBLE);
    }

    private void show(String theme, String scr, String bar, String vil, ScreenCore.Screen pre) {
        Pal.set(theme);
        applyBars();
        root.setBackgroundColor(Pal.c(Pal.BG));
        hdrView.setPalette(SvHost.palette(theme));
        renderer.build(scr, pre);
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
        w.setStatusBarColor(0xFF000000);                       // 상태 표시줄은 길동무처럼 늘 검정 + 흰 아이콘
        w.setNavigationBarColor(Pal.c(Pal.NAV));
        WindowInsetsControllerCompat ic = WindowCompat.getInsetsController(w, w.getDecorView());
        ic.setAppearanceLightStatusBars(false);
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
            quickFix();
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
            quickFix();
        } else {
            act("loc.denied", "");
        }
    }

    /** 날씨를 맞추려고 마지막으로 알려진 위치(없으면 새로 한 번)를 빨리 잡아 엔진에 넘긴다 — 부모에게 알리는 것과는 별개다. */
    private void quickFix() {
        if (!hasLocPerm()) return;
        long n = System.currentTimeMillis();
        if (n - lastQuick < 120000L) return;
        lastQuick = n;
        try {
            final FusedLocationProviderClient c = LocationServices.getFusedLocationProviderClient(this);
            c.getLastLocation().addOnSuccessListener(new OnSuccessListener<Location>() {
                @Override
                public void onSuccess(Location l) {
                    if (l != null) {
                        seen(l.getLatitude(), l.getLongitude());
                        return;
                    }
                    try {
                        CancellationTokenSource cts = new CancellationTokenSource();
                        c.getCurrentLocation(Priority.PRIORITY_BALANCED_POWER_ACCURACY, cts.getToken()).addOnSuccessListener(new OnSuccessListener<Location>() {
                            @Override
                            public void onSuccess(Location l2) {
                                if (l2 != null) seen(l2.getLatitude(), l2.getLongitude());
                            }
                        });
                    } catch (Throwable t) {
                        // 위치를 못 잡아도 앱은 계속 쓴다
                    }
                }
            });
        } catch (Throwable t) {
            // 위치를 못 잡아도 앱은 계속 쓴다
        }
    }

    private void seen(final double la, final double lo) {
        eh.post(new Runnable() {
            @Override
            public void run() {
                Core.engine.seenFix(la, lo);
                step();
            }
        });
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
