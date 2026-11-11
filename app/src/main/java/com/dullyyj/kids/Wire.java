package com.dullyyj.kids;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.ThreadFactory;

/**
 * 길동무 서버(읽기만)에 글을 보내고 답을 받는 작은 통로. 받아 오는 일은 전부 뒤 스레드(EX)에서 한다.
 * 길동무 앱이 같은 서버에 보내는 것과 같은 모양의 요청만 보낸다(장면 · 노선도 화면).
 */
final class Wire {
    static final String BASE = "https://route-v2.phg0643.workers.dev";
    static final int CAP = 29;
    private static final int MAX_RES = 1500000;

    static final ExecutorService EX = Executors.newFixedThreadPool(3, new ThreadFactory() {
        @Override
        public Thread newThread(Runnable r) {
            Thread t = new Thread(r, "kids-wire");
            t.setDaemon(true);
            return t;
        }
    });

    private Wire() {
    }

    /** POST 로 보내고 답 글을 돌려준다. 실패하면 null. */
    static String post(String path, String body, int timeoutMs) {
        HttpURLConnection c = null;
        boolean reuse = false;                                  // 답을 끝까지 읽었으면 연결을 끊지 않는다 — 다음 요청이 같은 연결(TLS 이미 끝남)을 이어 쓴다(길동무 NetPost 와 같다)
        try {
            c = (HttpURLConnection) new URL(BASE + path).openConnection();
            c.setConnectTimeout(timeoutMs);
            c.setReadTimeout(timeoutMs);
            c.setRequestMethod("POST");
            c.setDoOutput(true);
            c.setInstanceFollowRedirects(false);
            c.setRequestProperty("Content-Type", "application/json; charset=utf-8");
            byte[] b = body.getBytes("UTF-8");
            c.setFixedLengthStreamingMode(b.length);
            OutputStream os = c.getOutputStream();
            try {
                os.write(b);
            } finally {
                os.close();
            }
            if (c.getResponseCode() != 200) return null;
            InputStream in = c.getInputStream();
            try {
                ByteArrayOutputStream bo = new ByteArrayOutputStream();
                byte[] buf = new byte[8192];
                int n;
                while ((n = in.read(buf)) > 0) {
                    bo.write(buf, 0, n);
                    if (bo.size() > MAX_RES) return null;
                }
                String out = bo.toString("UTF-8");
                reuse = true;
                return out;
            } finally {
                in.close();
            }
        } catch (Throwable t) {
            return null;
        } finally {
            if (c != null && !reuse) c.disconnect();
        }
    }

    /** 다른 길동무 서버 주소에서 글을 받아 온다(GET). 실패하면 null. */
    static String get(String url, int timeoutMs) {
        HttpURLConnection c = null;
        boolean reuse = false;                                  // 답을 끝까지 읽었으면 연결을 끊지 않는다 — 다음 요청이 같은 연결(TLS 이미 끝남)을 이어 쓴다(길동무 NetPost 와 같다)
        try {
            c = (HttpURLConnection) new URL(url).openConnection();
            c.setConnectTimeout(timeoutMs);
            c.setReadTimeout(timeoutMs);
            c.setRequestMethod("GET");
            c.setInstanceFollowRedirects(false);
            if (c.getResponseCode() != 200) return null;
            InputStream in = c.getInputStream();
            try {
                ByteArrayOutputStream bo = new ByteArrayOutputStream();
                byte[] buf = new byte[8192];
                int n;
                while ((n = in.read(buf)) > 0) {
                    bo.write(buf, 0, n);
                    if (bo.size() > MAX_RES) return null;
                }
                String out = bo.toString("UTF-8");
                reuse = true;
                return out;
            } finally {
                in.close();
            }
        } catch (Throwable t) {
            return null;
        } finally {
            if (c != null && !reuse) c.disconnect();
        }
    }
}
