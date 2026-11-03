package com.dullyyj.kids;

/**
 * 과다 터치 방지: 1초 안에 3번 이상 누르면(연타) 첫 번째만 받고, 손가락을 떼고 1초가 지날 때까지 나머지는 무시한다.
 * 시각을 밖에서 받는 순수 계산이라 안드로이드를 모른다(JVM 에서 시험한다).
 */
final class TapGate {
    private final long windowMs;
    private final int n;
    private final long[] taps;
    private int i = 0;
    private long mutedUntil = 0L;

    TapGate(long windowMs, int n) {
        this.windowMs = windowMs;
        this.n = n;
        this.taps = new long[n];
    }

    /** 누를 때마다 부른다. true 면 이 누름은 무시한다. */
    synchronized boolean burst(long now) {
        taps[i] = now;
        i = (i + 1) % n;
        long oldest = taps[i];                       // n 번 전 누름(없으면 0)
        if (now < mutedUntil) {                      // 연타가 이어지는 동안은 누를 때마다 무시 시간이 늘어난다
            mutedUntil = now + windowMs;
            return true;
        }
        if (oldest > 0L && now - oldest < windowMs) {   // 방금이 n 번째 — 이번 누름부터 무시
            mutedUntil = now + windowMs;
            return true;
        }
        return false;
    }
}
