package com.dullyyj.kids;

import android.content.Context;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.os.Handler;
import android.os.Looper;
import android.util.LruCache;

import java.io.InputStream;
import java.util.HashSet;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/** 길동무 3D 캐릭터 프레임 시트(assets/chars3d/*.webp, 4x4칸)를 백그라운드에서 읽어 둔다. 메인 스레드는 읽지 않는다. */
final class Sheets {
    private final Context ctx;
    private final LruCache<String, Bitmap> cache = new LruCache<String, Bitmap>(80 * 1024 * 1024) {
        @Override
        protected int sizeOf(String k, Bitmap b) {
            return b.getByteCount();
        }
    };
    private final HashSet<String> loading = new HashSet<String>();
    private final HashSet<String> missing = new HashSet<String>();
    private final ExecutorService ex = Executors.newFixedThreadPool(2);
    private final Handler main = new Handler(Looper.getMainLooper());

    Sheets(Context c) {
        ctx = c.getApplicationContext();
    }

    static String walkFile(String id) {
        return "bbosong".equals(id) ? "bbosong_0" : id;
    }

    static String actFile(String id) {
        return "bbosong".equals(id) ? "bbosong_0_act" : id + "_act";
    }

    /** 읽혀 있으면 바로 돌려주고, 아니면 null 을 주고 뒤에서 읽은 다음 done 을 메인 스레드에서 부른다. */
    Bitmap get(final String file, final Runnable done) {
        Bitmap b = cache.get(file);
        if (b != null) return b;
        synchronized (this) {
            if (missing.contains(file) || loading.contains(file)) return null;
            loading.add(file);
        }
        ex.execute(new Runnable() {
            @Override
            public void run() {
                Bitmap r = null;
                try {
                    InputStream in = ctx.getAssets().open("chars3d/" + file + ".webp");
                    try {
                        r = BitmapFactory.decodeStream(in);
                    } finally {
                        in.close();
                    }
                } catch (Throwable t) {
                    r = null;
                }
                synchronized (Sheets.this) {
                    loading.remove(file);
                    if (r == null) missing.add(file);
                }
                if (r != null) {
                    cache.put(file, r);
                    if (done != null) main.post(done);
                }
            }
        });
        return null;
    }
}
