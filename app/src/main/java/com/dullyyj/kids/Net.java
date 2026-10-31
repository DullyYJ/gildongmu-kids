package com.dullyyj.kids;

import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/** 서버(워커) 호출. 서버 주소(api)가 비어 있으면 아무것도 보내지 않는다(서버 연결 전). */
final class Net {
    private static final ExecutorService EX = Executors.newSingleThreadExecutor();

    private Net() {}

    static void postLoc(final double lat, final double lng, final float acc, final long ts) {
        final String base = Core.store.get("api", "");
        if (base == null || base.isEmpty()) return;
        EX.execute(new Runnable() {
            @Override
            public void run() {
                HttpURLConnection c = null;
                try {
                    URL u = new URL(base + "/kid/loc");
                    c = (HttpURLConnection) u.openConnection();
                    c.setRequestMethod("POST");
                    c.setConnectTimeout(8000);
                    c.setReadTimeout(8000);
                    c.setDoOutput(true);
                    c.setRequestProperty("Content-Type", "application/json");
                    String body = "{\"cid\":\"" + Core.engine.childId() + "\",\"sec\":\"" + Core.engine.childSecret()
                            + "\",\"lat\":" + lat + ",\"lng\":" + lng + ",\"acc\":" + acc + ",\"ts\":" + ts + "}";
                    OutputStream os = c.getOutputStream();
                    os.write(body.getBytes("UTF-8"));
                    os.close();
                    c.getResponseCode();
                } catch (Throwable t) {
                    // 다음 주기에 다시 보낸다
                } finally {
                    if (c != null) c.disconnect();
                }
            }
        });
    }
}
