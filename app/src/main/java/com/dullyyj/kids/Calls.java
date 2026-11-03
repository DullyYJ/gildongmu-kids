package com.dullyyj.kids;

import android.app.Activity;
import android.content.Intent;
import android.net.Uri;
import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;
import android.os.VibrationEffect;
import android.os.Vibrator;
import android.widget.Toast;

/**
 * 자녀가 부모님께 알리는 세 가지 — 긴급 호출 · 안전하게 도착했어요 · 데리러 와 주세요(s399).
 *
 * 버튼은 아직 화면에 달지 않았다(자리는 YJ 가 정한다). 버튼의 눌림에서 아래 셋 중 하나만 부르면 된다(주 스레드에서):
 *   Calls.sos(activity)      — 10초 세기(취소 · 119 단추) → 부모님 두 분께 알림 + 위치 → 부모님이 확인하면 이 화면에 글이 바뀐다
 *   Calls.arrived(activity)  — 눌러서 바로 "안전하게 도착했어요" (2분 안에 또 눌러도 알림은 한 번)
 *   Calls.pickup(activity)   — 한 번 물어보고 "데리러 와 주세요" → 부모님이 "지금 가요" 하면 이 화면에 글이 바뀐다
 *
 * 판단(알림 글 · 장소 이름 · 되풀이 막기 · 부모 확인)은 모두 서버(engine/kids-worker.js /c/call)가 한다. 여기는 누른 일을 보내고 서버가 준 글을 보여 주기만 한다.
 */
public final class Calls {
    private static final int COUNT = 10;
    private static final Handler MAIN = new Handler(Looper.getMainLooper());

    private Calls() {
    }

    // ───────── 과다 터치 방지: 1초에 3번 이상 누르면 알림은 한 번만 ─────────
    private static final TapGate GATE = new TapGate(1000L, 3);

    /** 누를 때마다 부른다. 1초 안에 3번 이상 누르면 첫 번째만 보내고 나머지는 무시한다(true = 이 누름은 무시). */
    static boolean burst() {
        return GATE.burst(SystemClock.uptimeMillis());
    }

    /** 연결된 부모님이 없으면 누를 수 없다(단추는 회색) — 마지막으로 서버에서 받은 연결 수로 정한다. */
    static boolean linkedOk() {
        return Core.engine != null && Core.engine.hasParent();
    }

    static void noParentToast(Activity a) {
        if (a != null && !a.isFinishing() && !a.isDestroyed()) Toast.makeText(a, "부모님과 연결하면 쓸 수 있어요", Toast.LENGTH_SHORT).show();
    }

    private static void buzz(Activity a, long ms) {
        try {
            Vibrator v = (Vibrator) a.getSystemService(Activity.VIBRATOR_SERVICE);
            if (v != null) v.vibrate(VibrationEffect.createOneShot(ms, VibrationEffect.DEFAULT_AMPLITUDE));
        } catch (Throwable ignored) {
            // 진동이 없어도 된다
        }
    }

    private static void dial119(Activity a) {
        try {
            a.startActivity(new Intent(Intent.ACTION_DIAL, Uri.parse("tel:119")));
        } catch (Throwable ignored) {
            // 전화 앱이 없으면 건너뛴다
        }
    }

    private static boolean ready(Activity a) {
        if (a == null || a.isFinishing() || a.isDestroyed()) return false;
        if (Core.engine == null || !Core.engine.consented()) {
            Toast.makeText(a, "먼저 동의와 연결을 마쳐 주세요", Toast.LENGTH_SHORT).show();
            return false;
        }
        return true;
    }

    // ───────── 긴급 호출 ─────────

    /** 10초를 세고(취소할 수 있다) 부모님께 긴급 호출을 보낸다. 119 단추는 전화 앱의 119 번호 입력 화면을 연다(바로 걸지는 않는다). */
    public static void sos(Activity a) {
        sos(a, COUNT);
    }

    /** sec 초를 세고 보낸다(홈 화면을 5초 눌러 부를 때는 이미 5초를 꾹 눌렀으니 5초만 센다). */
    public static void sos(final Activity a, final int sec) {
        if (burst() || !ready(a)) return;
        final int[] left = {sec};
        final boolean[] stop = {false};
        final Pop.Win d = Pop.show(a, "긴급 호출", sec + "초 뒤에 부모님께 알려요", false,
                new Pop.Btn("119", Pop.ALERT, new Runnable() {
                    @Override
                    public void run() {
                        stop[0] = true;
                        dial119(a);
                    }
                }),
                new Pop.Btn("취소", Pop.MAIN, new Runnable() {
                    @Override
                    public void run() {
                        stop[0] = true;
                    }
                }));
        final Runnable[] tick = new Runnable[1];
        tick[0] = new Runnable() {
            @Override
            public void run() {
                if (stop[0] || a.isFinishing() || a.isDestroyed()) {
                    d.dismiss();
                    return;
                }
                left[0]--;
                if (left[0] <= 0) {
                    d.dismiss();
                    sendSos(a);
                    return;
                }
                buzz(a, 40L);
                d.setMessage(left[0] + "초 뒤에 부모님께 알려요");
                MAIN.postDelayed(tick[0], 1000L);
            }
        };
        buzz(a, 120L);
        MAIN.postDelayed(tick[0], 1000L);
    }

    private static void sendSos(final Activity a) {
        buzz(a, 400L);
        Core.engine.callSend("sos", false, new Engine.CallCb() {
            @Override
            public void done(final boolean ok, final int linked, boolean dup) {
                MAIN.post(new Runnable() {
                    @Override
                    public void run() {
                        if (a.isFinishing() || a.isDestroyed()) return;
                        if (!ok) failed(a, "sos", "보내지 못했어요. 연결을 확인하고 다시 보내거나 119에 전화해 주세요");
                        else if (linked == 0) noParent(a);
                        else status(a, "sos", "부모님께 알렸어요");
                    }
                });
            }
        });
    }

    private static void noParent(final Activity a) {
        Pop.show(a, "연결된 부모님이 없어요", "지금 위급하면 119에 전화해 주세요", true,
                new Pop.Btn("닫기", Pop.PLAIN, null),
                new Pop.Btn("119", Pop.ALERT, new Runnable() {
                    @Override
                    public void run() {
                        dial119(a);
                    }
                }));
    }

    private static void failed(final Activity a, final String kind, String msg) {
        final boolean sos = "sos".equals(kind);
        Pop.Btn again = new Pop.Btn("다시 보내기", Pop.MAIN, new Runnable() {
            @Override
            public void run() {
                if (sos) sendSos(a);
                else sendPickup(a);
            }
        });
        Pop.Btn close = new Pop.Btn("닫기", Pop.PLAIN, null);
        if (sos) {
            Pop.show(a, "긴급 호출", msg, true, new Pop.Btn("119", Pop.ALERT, new Runnable() {
                @Override
                public void run() {
                    dial119(a);
                }
            }), close, again);
        } else {
            Pop.show(a, "데리러 와 주세요", msg, true, close, again);
        }
    }

    /** 보낸 뒤 상태 창: 서버가 정한 글(부모님이 확인하면 바뀐다)을 2초마다 읽어 보여 주고, "괜찮아요" 로 취소할 수 있다(최대 10분). */
    private static void status(final Activity a, final String kind, String first) {
        final boolean sos = "sos".equals(kind);
        final boolean[] gone = {false};
        Pop.Btn cancel = new Pop.Btn("괜찮아요(취소)", Pop.PLAIN, new Runnable() {
            @Override
            public void run() {
                Core.engine.callSend(kind, true, null);
                Toast.makeText(a, "취소했어요", Toast.LENGTH_SHORT).show();
            }
        });
        Pop.Btn close = new Pop.Btn("닫기", Pop.MAIN, null);
        final Pop.Win d = sos
                ? Pop.show(a, "긴급 호출", first, true, new Pop.Btn("119", Pop.ALERT, new Runnable() {
                    @Override
                    public void run() {
                        dial119(a);
                    }
                }), cancel, close)
                : Pop.show(a, "데리러 와 주세요", first, true, cancel, close);
        d.onDismiss(new Runnable() {
            @Override
            public void run() {
                gone[0] = true;
            }
        });
        final long end = System.currentTimeMillis() + 10 * 60000L;
        final Runnable[] poll = new Runnable[1];
        poll[0] = new Runnable() {
            @Override
            public void run() {
                if (gone[0] || a.isFinishing() || a.isDestroyed() || System.currentTimeMillis() > end) return;
                String t = Core.engine.callText();
                if (t != null && !t.isEmpty()) d.setMessage(t);
                MAIN.postDelayed(poll[0], 2000L);
            }
        };
        MAIN.postDelayed(poll[0], 2000L);
    }

    // ───────── 안전하게 도착했어요 ─────────

    /** 화면 단추용: 실수로 눌러도 부모님께 거짓 안심을 드리지 않게 한 번 물어본 뒤 알린다. */
    public static void arrivedAsk(final Activity a) {
        if (burst() || !ready(a)) return;
        if (!linkedOk()) { noParentToast(a); return; }
        Pop.show(a, "안전 도착", "안전하게 도착했다고 부모님께 알릴까요?", true,
                new Pop.Btn("아니요", Pop.PLAIN, null),
                new Pop.Btn("알리기", Pop.MAIN, new Runnable() {
                    @Override
                    public void run() {
                        arrived(a);
                    }
                }));
    }

    /** 눌러서 바로 "안전하게 도착했어요" 를 알린다(서버가 장소 이름을 붙이고, 2분 안의 되풀이는 알림을 또 보내지 않는다). */
    public static void arrived(final Activity a) {
        if (burst() || !ready(a)) return;
        Core.engine.callSend("arr", false, new Engine.CallCb() {
            @Override
            public void done(final boolean ok, final int linked, final boolean dup) {
                MAIN.post(new Runnable() {
                    @Override
                    public void run() {
                        if (a.isFinishing() || a.isDestroyed()) return;
                        String m = !ok ? "보내지 못했어요. 연결을 확인해 주세요" : linked == 0 ? "연결된 부모님이 없어요" : dup ? "방금 알렸어요" : "부모님께 안전하게 도착했다고 알렸어요";
                        Toast.makeText(a, m, Toast.LENGTH_SHORT).show();
                    }
                });
            }
        });
    }

    // ───────── 데리러 와 주세요 ─────────

    /** "데리러 와 달라고 부모님께 알릴까요?" 를 물어보고 보낸다. */
    public static void pickup(final Activity a) {
        if (burst() || !ready(a)) return;
        if (!linkedOk()) { noParentToast(a); return; }
        Pop.show(a, "데리러 와 주세요", "부모님께 데리러 와 달라고 알릴까요?", true,
                new Pop.Btn("아니요", Pop.PLAIN, null),
                new Pop.Btn("알리기", Pop.MAIN, new Runnable() {
                    @Override
                    public void run() {
                        sendPickup(a);
                    }
                }));
    }

    private static void sendPickup(final Activity a) {
        Core.engine.callSend("pick", false, new Engine.CallCb() {
            @Override
            public void done(final boolean ok, final int linked, boolean dup) {
                MAIN.post(new Runnable() {
                    @Override
                    public void run() {
                        if (a.isFinishing() || a.isDestroyed()) return;
                        if (!ok) failed(a, "pick", "보내지 못했어요. 연결을 확인해 주세요");
                        else if (linked == 0) Toast.makeText(a, "연결된 부모님이 없어요", Toast.LENGTH_SHORT).show();
                        else status(a, "pick", "부모님께 알렸어요");
                    }
                });
            }
        });
    }
}
