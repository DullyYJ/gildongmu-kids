package com.dullyyj.kids;

/**
 * 마을에서 친구가 어슬렁거리는 자리 — 엔진 쪽 계산(순수 자바, 안드로이드 몰라도 됨).
 * 친구 이름표(id)와 '걸은 시간(초)'만 정해지면 어디에 있고 어느 쪽을 보고 걷는지가 늘 같게 나온다(무작위 없음).
 * 뷰(VillageView)는 걷는 동안의 시간만 세어 이 함수에 물어보고, 받은 자리에 그리기만 한다.
 *
 * 한 바퀴 = N 번의 (서 있기 → 걷기). k 번째: T[k] 에서 w[k] 초 서 있다가 T[k+1] 로 SPEED 로 걷는다. 마지막은 처음 자리(T[0])로 돌아와 이어진다.
 */
final class Wander {
    private Wander() {}

    static final int N = 48;                   // 한 바퀴 구간 수
    static final float SPEED = 0.07f;          // 초당 이동(0~1 가로 비율)
    static final float LO = 0.08f, HI = 0.92f; // 가는 자리 범위
    static final float WAIT_MIN = 0.6f, WAIT_VAR = 3f;

    /** 자리·방향·걷는 중인지. */
    static final class Pose {
        float x = 0.5f;      // 0.08~0.92
        float dir = 1f;      // +1 오른쪽 · -1 왼쪽
        boolean moving;
    }

    private static int mix(int a, int b) {
        int x = a * 0x9E3779B1 ^ b * 0x85EBCA6B;
        x ^= x >>> 15; x *= 0x2C1B3C6D; x ^= x >>> 12; x *= 0x297A2D39; x ^= x >>> 15;
        return x;
    }

    private static float r(int seed, int k) {
        return (mix(seed, k) & 0x7fffffff) / 2147483648f;
    }

    private static int seed(String id) {
        return id == null ? 0 : id.hashCode();
    }

    private static float target(int seed, int k) {
        return LO + (HI - LO) * r(seed, 2 * (k % N) + 1);
    }

    private static float wait(int seed, int k) {
        return WAIT_MIN + WAIT_VAR * r(seed, 2 * (k % N));
    }

    /** 한 바퀴가 도는 데 걸리는 시간(초). */
    static double cycle(String id) {
        int s = seed(id);
        double tot = 0;
        for (int k = 0; k < N; k++) tot += wait(s, k) + Math.abs(target(s, k + 1) - target(s, k)) / SPEED;
        return tot;
    }

    /** 이 친구가 처음 놓이는 때(걸은 시간 0 대신 친구마다 다른 자리에서 시작하게). */
    static double start(String id) {
        return cycle(id) * r(seed(id), 7777);
    }

    /** 응가·말풍선 몸짓 흔들림이 친구마다 어긋나도록 쓰는 0~999 숫자. */
    static int phase(String id) {
        return (int) (r(seed(id), 4242) * 1000f);
    }

    /** 걸은 시간 t(초)에서의 모습. 같은 id·같은 t 는 언제 불러도 같다. */
    static void at(String id, double t, Pose out) {
        int s = seed(id);
        double tot = cycle(id);
        double u = t % tot;
        if (u < 0) u += tot;
        float lastDir = Math.signum(target(s, 0) - target(s, N - 1));
        if (lastDir == 0f) lastDir = 1f;
        for (int k = 0; k < N; k++) {
            float a = target(s, k), b = target(s, k + 1);
            double w = wait(s, k);
            if (u < w) {
                out.x = a; out.dir = lastDir; out.moving = false;
                return;
            }
            u -= w;
            float d = b - a;
            double dur = Math.abs(d) / SPEED;
            if (d != 0f) lastDir = d > 0f ? 1f : -1f;
            if (u < dur) {
                out.x = (float) (a + lastDir * SPEED * u); out.dir = lastDir; out.moving = true;
                return;
            }
            u -= dur;
        }
        out.x = target(s, 0); out.dir = lastDir; out.moving = false;
    }
}
