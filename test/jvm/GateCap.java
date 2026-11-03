// 과다 터치 방지(TapGate) 시험(s405): 1초에 3번 이상 누르면 첫 번째만 받고, 연타가 이어지는 동안 무시, 멈추고 1초 지나면 다시 받는다. 안드로이드를 모르는 순수 계산.
// 실행: javac -d out app/src/main/java/com/dullyyj/kids/TapGate.java test/jvm/GateCap.java && java -cp out com.dullyyj.kids.GateCap
package com.dullyyj.kids;

public class GateCap {
    static int fails = 0;
    static void ok(boolean c, String n) { System.out.println((c ? "ok   " : "FAIL ") + n); if (!c) fails++; }
    public static void main(String[] a) {
        TapGate g = new TapGate(1000L, 3);
        ok(!g.burst(10000), "첫 번째 누름은 받는다");
        ok(!g.burst(10600), "1초 안에 2번째도 받는다(2번까지는 정상)");
        ok(g.burst(10900), "1초 안에 3번째는 연타 — 무시");
        ok(g.burst(11200), "연타가 이어지면 계속 무시");
        ok(g.burst(11900), "마지막 누름 뒤 1초가 안 지났으면 계속 무시");
        ok(!g.burst(13000), "연타가 멈추고 1초가 지나면 다시 받는다");
        TapGate h = new TapGate(1000L, 3);
        ok(!h.burst(1000) && !h.burst(2100) && !h.burst(3200) && !h.burst(4300), "1초보다 느리게 누르면 몇 번이든 받는다");
        TapGate k = new TapGate(1000L, 3);
        int sent = 0;
        for (int i = 0; i < 10; i++) if (!k.burst(5000 + i * 100L)) sent++;
        ok(sent == 2, "0.1초 간격으로 10번 연타하면 앞의 2번만 받는다(3번째부터 무시) — 실제 알림은 첫 번째 누름의 확인 창 하나");
        System.out.println(fails == 0 ? "ALL OK" : fails + " FAIL");
        System.exit(fails == 0 ? 0 : 1);
    }
}
