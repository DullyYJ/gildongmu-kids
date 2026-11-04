package com.dullyyj.kids;

import java.util.concurrent.TimeUnit;

import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.Response;
import okhttp3.WebSocket;
import okhttp3.WebSocketListener;

/**
 * s426: 서버 초인종(WebSocket). 서버가 "바뀌었다"는 한 줄({"r":번호})만 보내고, 앱은 그걸 듣고 평소 요청으로 새 화면을 받아 간다.
 * 이 클래스는 연결을 붙들고 울림을 알려 주는 통로일 뿐 — 무엇을 언제 할지는 엔진(Engine)이 정한다(재시도 간격의 흩뿌림도 엔진이 넘겨 준다).
 * 서버가 이 기능을 꺼 두었거나(404) 연결이 안 되면 곧바로 예전 긴 대기로 돌아간다. 주 스레드에서 부르지 않는다.
 */
final class Door {
    private static final OkHttpClient HTTP = new OkHttpClient.Builder()
            .pingInterval(30, TimeUnit.SECONDS)                 // 연결이 조용히 죽었는지 확인(서버 절전 객체는 깨우지 않는 신호)
            .connectTimeout(8, TimeUnit.SECONDS)
            .build();
    private static final int PAUSE_AFTER = 5;                   // 연달아 이만큼 실패하면 한동안(10분) 시도하지 않는다 — 서버가 계속 거절하는데 두드리지 않게

    private final Object lock = new Object();
    private WebSocket ws;
    private int gen;
    private volatile boolean up;
    private boolean connecting;
    private long seq;                                         // 울릴 때마다 하나씩 늘어난다 — 기다리는 쪽이 여럿이어도 각자 자기가 본 값과 비교한다
    private int fails;
    private long nextTry;

    /** 연결돼 있나 */
    boolean isUp() {
        return up;
    }

    /** 연달아 실패한 횟수 */
    int fails() {
        synchronized (lock) {
            return fails;
        }
    }

    /** 지금까지 울린 횟수 — 새 화면을 받으러 가기 직전에 적어 두었다가 await 에 넘긴다(그 사이 울린 것을 놓치지 않으려고). */
    long seq() {
        synchronized (lock) {
            return seq;
        }
    }

    /** 기다리던 쪽을 모두 깨운다(화면이 바뀌거나 앱이 뒤로 갈 때). */
    void wake() {
        synchronized (lock) {
            seq++;
            lock.notifyAll();
        }
    }

    /** seen 보다 더 울릴 때까지(또는 연결이 끊길 때까지, 최대 maxMs) 기다린다. 울렸으면 true. */
    boolean await(long seen, long maxMs) throws InterruptedException {
        long end = System.currentTimeMillis() + Math.max(5000L, Math.min(maxMs, 120000L));       // 서버가 준 시간이 엉뚱해도 5초~2분 안
        synchronized (lock) {
            while (seq == seen && up) {
                long left = end - System.currentTimeMillis();
                if (left <= 0) return false;
                lock.wait(left);
            }
            return seq != seen;
        }
    }

    /** 연결이 없으면(그리고 쉬는 시간이 지났으면) 새로 건다. jitterMs 는 엔진이 정해 준 흩뿌림(여러 기기가 한꺼번에 다시 걸지 않게). */
    void ensure(String url, String id, String sec, long jitterMs) {
        final int my;
        synchronized (lock) {
            if (up || connecting || System.currentTimeMillis() < nextTry) return;
            connecting = true;
            my = ++gen;
        }
        try {
            Request rq = new Request.Builder().url(url).header("x-id", id).header("x-sec", sec).build();
            WebSocket w = HTTP.newWebSocket(rq, new Listener(my, jitterMs));
            synchronized (lock) {
                if (my == gen) ws = w;
                else w.cancel();
            }
        } catch (Exception e) {
            lost(my, jitterMs);
        }
    }

    /** 연결을 닫는다(앱이 뒤로 가면). */
    void close() {
        WebSocket w;
        synchronized (lock) {
            gen++;
            w = ws;
            ws = null;
            up = false;
            connecting = false;
            seq++;
            lock.notifyAll();
        }
        if (w != null) {
            try {
                w.close(1000, "bye");
            } catch (Exception e) {
                // 이미 닫힘
            }
        }
    }

    private void lost(int my, long jitterMs) {
        synchronized (lock) {
            if (my != gen) return;
            ws = null;
            up = false;
            connecting = false;
            fails++;
            long base = fails >= PAUSE_AFTER ? 600000L : Math.min(5000L << Math.min(fails - 1, 4), 60000L);
            nextTry = System.currentTimeMillis() + base + Math.max(0L, jitterMs);
            lock.notifyAll();
        }
    }

    private final class Listener extends WebSocketListener {
        private final int my;
        private final long jitter;

        Listener(int my, long jitter) {
            this.my = my;
            this.jitter = jitter;
        }

        @Override
        public void onOpen(WebSocket w, Response r) {
            synchronized (lock) {
                if (my != gen) {
                    w.cancel();
                    return;
                }
                up = true;
                connecting = false;
                fails = 0;
                seq++;                                           // 막 이어졌다 — 그 사이 바뀐 게 있을 수 있으니 한 번은 새로 받아 본다
                lock.notifyAll();
            }
        }

        @Override
        public void onMessage(WebSocket w, String text) {
            if (text == null || text.indexOf("\"r\"") < 0) return;   // 인사({"hi":1}) 같은 건 울림이 아니다
            synchronized (lock) {
                if (my != gen) return;
                seq++;
                lock.notifyAll();
            }
        }

        @Override
        public void onClosing(WebSocket w, int code, String reason) {
            try {
                w.close(1000, null);
            } catch (Exception e) {
                // 이미 닫힘
            }
            lost(my, jitter);
        }

        @Override
        public void onClosed(WebSocket w, int code, String reason) {
            lost(my, jitter);
        }

        @Override
        public void onFailure(WebSocket w, Throwable t, Response r) {
            lost(my, jitter);
        }
    }
}
