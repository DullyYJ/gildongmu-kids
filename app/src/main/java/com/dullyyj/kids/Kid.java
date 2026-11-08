package com.dullyyj.kids;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;

/**
 * 길동무 패밀리 서버(Cloudflare Worker + D1, engine/kids-worker.js)와 말하는 작은 통로.
 * 가족대화 · 퀘스트 · 부모 연결 · 위치는 모두 이 서버가 계산하고 저장한다. 앱은 받은 화면을 그리기만 한다.
 * 모든 호출은 뒤 스레드(Wire.EX)에서만 쓴다 — 주 스레드에서 부르지 않는다.
 */
final class Kid {
    static final String BASE = "https://gildongmu-kids.phg0643.workers.dev";
    private static final int MAX_RES = 400000;

    private Kid() {
    }

    /** 요청을 보내고 답 글을 돌려준다(서버가 오류 답을 줘도 글은 돌려준다). 연결 자체가 안 되면 null. id 가 비면 인증 머리글을 붙이지 않는다. */
    static String call(String method, String path, String body, String id, String sec) {
        return callT(method, path, body, id, sec, 10000);
    }

    /** 읽기 제한 시간을 정해 부른다(서버가 바뀔 때까지 붙들어 두는 긴 대기 /c/wait 는 이걸로). */
    static String callT(String method, String path, String body, String id, String sec, int readMs) {
        HttpURLConnection c = null;
        try {
            c = (HttpURLConnection) new URL(BASE + path).openConnection();
            c.setConnectTimeout(8000);
            c.setReadTimeout(readMs);
            c.setRequestMethod(method);
            c.setInstanceFollowRedirects(false);
            if (id != null && !id.isEmpty()) {
                c.setRequestProperty("x-id", id);
                c.setRequestProperty("x-sec", sec);
            }
            if (body != null) {
                byte[] b = body.getBytes("UTF-8");
                c.setDoOutput(true);
                c.setRequestProperty("Content-Type", "application/json; charset=utf-8");
                c.setFixedLengthStreamingMode(b.length);
                OutputStream os = c.getOutputStream();
                try {
                    os.write(b);
                } finally {
                    os.close();
                }
            }
            int code = c.getResponseCode();
            InputStream in = code >= 400 ? c.getErrorStream() : c.getInputStream();
            if (in == null) return null;
            try {
                ByteArrayOutputStream bo = new ByteArrayOutputStream();
                byte[] buf = new byte[8192];
                int n;
                while ((n = in.read(buf)) > 0) {
                    bo.write(buf, 0, n);
                    if (bo.size() > MAX_RES) return null;
                }
                return bo.toString("UTF-8");
            } finally {
                in.close();
            }
        } catch (Exception e) {
            return null;
        } finally {
            if (c != null) c.disconnect();
        }
    }
}
