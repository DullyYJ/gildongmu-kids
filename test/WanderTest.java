package com.dullyyj.kids;

/** 마을 어슬렁 자리(엔진) 시험(JVM): java -cp out com.dullyyj.kids.WanderTest */
public class WanderTest {
    static int fail = 0;
    static void ok(boolean c, String m) { System.out.println((c ? "  ok   " : "  FAIL ") + m); if (!c) fail++; }

    public static void main(String[] a) {
        String[] ids = {"a1", "b2", "kid-007", "친구", ""};
        Wander.Pose p = new Wander.Pose(), q = new Wander.Pose();
        boolean same = true, range = true, cont = true, moved = false, waited = false;
        for (String id : ids) {
            double cyc = Wander.cycle(id);
            for (double t = 0; t < cyc * 2.2; t += 0.05) {
                Wander.at(id, t, p); Wander.at(id, t, q);
                if (p.x != q.x || p.dir != q.dir || p.moving != q.moving) same = false;
                if (p.x < Wander.LO - 1e-4f || p.x > Wander.HI + 1e-4f) range = false;
                Wander.Pose n = new Wander.Pose(); Wander.at(id, t + 0.05, n);
                if (Math.abs(n.x - p.x) > Wander.SPEED * 0.05 + 1e-3) cont = false;
                if (p.moving) moved = true; else waited = true;
            }
        }
        ok(same, "같은 친구·같은 시간이면 늘 같은 자리·방향(무작위 없음)");
        ok(range, "자리는 늘 0.08~0.92 안");
        ok(cont, "순간이동 없이 이어진다(걷는 속도 이하로만 움직인다)");
        ok(moved && waited, "서 있기와 걷기가 모두 나온다");
        double c0 = Wander.cycle("a1");
        Wander.at("a1", 3.7, p); Wander.at("a1", 3.7 + c0, q);
        ok(Math.abs(p.x - q.x) < 1e-3 && p.dir == q.dir, "한 바퀴가 돌아 처음으로 이어진다 (주기 " + (int) c0 + "초)");
        Wander.at("a1", 12, p); Wander.at("b2", 12, q);
        ok(Wander.start("a1") != Wander.start("b2") && Wander.phase("a1") != Wander.phase("b2"), "친구마다 시작 자리·흔들림이 다르다");
        Wander.at("a1", -5, p);
        ok(p.x >= Wander.LO - 1e-4f && p.x <= Wander.HI + 1e-4f, "음수 시간도 안전");
        boolean dirOk = true;
        for (double t = 0; t < c0; t += 0.1) { Wander.at("a1", t, p); Wander.at("a1", t + 0.1, q); if (p.moving && q.moving && (q.x - p.x) * p.dir < -1e-4f) dirOk = false; }
        ok(dirOk, "걷는 동안 보는 방향으로 나아간다");
        System.out.println(fail == 0 ? "WanderTest OK" : "WanderTest FAIL " + fail);
        System.exit(fail == 0 ? 0 : 1);
    }
}
