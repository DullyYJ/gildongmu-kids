// 장면 아래 모서리 호출 버튼(안전 도착 · 데리러 와줘) 시험(s400) — test/jvm/HelloCap.java 와 같은 방법으로 만든 JVM 환경에서 돌린다(클래스 이름 HB, HJ.mk 를 쓴다).
// 눌러서 떼면 Poke.call(arr|pick), 14dp 넘게 움직이거나 1.5초 넘으면 취소, render 에 같이 그려져도 예외 없음.
package com.dullyyj.subway;
import java.awt.image.BufferedImage;
import java.util.*;
public class HB {
    static int fails = 0;
    static void ok(boolean c, String n) { System.out.println((c ? "ok   " : "FAIL ") + n); if (!c) fails++; }
    public static void main(String[] a) throws Exception {
        final List<String> calls = new ArrayList<>();
        com.dullyyj.kids.Poke.setCaller(w -> calls.add(w));
        com.dullyyj.kids.Poke.setCallOk(true);                                  // 연결된 부모님이 있다
        SceneCore c = HJ.mk(3);
        HJ.adv(c, 2);
        double k = c.k;
        double[] L = KidsActs.btnRect(c, 0), R = KidsActs.btnRect(c, 1);
        ok(L[0] < c.W / 2 && R[0] > c.W / 2 && L[1] > c.H * .8 && Math.abs(L[3] * k - 36) < 1e-6, "버튼 둘: 왼쪽 · 오른쪽, 아래쪽, 높이 36dp");
        ok(Math.abs(L[0] * k - 10) < 1e-6 && Math.abs((c.W - R[0] - R[2]) * k - 10) < 1e-6, "모서리에서 10dp 안쪽");
        // 왼쪽 버튼 짧게 눌러 뗀다
        double lx = (L[0] + L[2] / 2) * k, ly = (L[1] + L[3] / 2) * k;
        ok(c.down(lx, ly), "버튼 위를 누르면 장면이 받는다(캐릭터 집기와 안 섞임)");
        HJ.adv(c, .2); c.up();
        ok(calls.equals(Arrays.asList("arr")), "왼쪽 버튼 → arr");
        // 오른쪽
        double rx = (R[0] + R[2] / 2) * k, ry = (R[1] + R[3] / 2) * k;
        ok(c.down(rx, ry), "오른쪽 버튼 누름"); HJ.adv(c, .2); c.up();
        ok(calls.equals(Arrays.asList("arr", "pick")), "오른쪽 버튼 → pick");
        // 움직이면 취소
        calls.clear();
        c.down(lx, ly); c.move(lx + 30, ly); HJ.adv(c, .1); c.up();
        ok(calls.isEmpty(), "누른 채 14dp 넘게 움직이면(스크롤) 보내지 않는다");
        // 오래 누르면 취소
        c.down(lx, ly); HJ.adv(c, 2); c.up();
        ok(calls.isEmpty(), "1.5초를 넘겨 누르면 보내지 않는다");
        // 연결된 부모님이 없으면(회색): 눌러도 arr/pick 이 가지 않고 안내("off")만 간다 · 그려도 예외 없음
        com.dullyyj.kids.Poke.setCallOk(false);
        calls.clear();
        ok(c.down(lx, ly), "회색 버튼도 장면이 받는다(뒤의 캐릭터가 눌리지 않게)"); HJ.adv(c, .2); c.up();
        ok(calls.equals(Arrays.asList("off")), "연결 없음: 왼쪽 버튼 → off(안내만, arr 없음)");
        calls.clear(); c.down(rx, ry); HJ.adv(c, .2); c.up();
        ok(calls.equals(Arrays.asList("off")), "연결 없음: 오른쪽 버튼 → off(pick 없음)");
        BufferedImage gimg = new BufferedImage((int) (c.PW * 1.5), (int) (c.PH * 1.5), BufferedImage.TYPE_INT_ARGB);
        try { c.render(new AwtCv(gimg.createGraphics())); ok(true, "회색 버튼도 예외 없이 그려진다"); } catch (Throwable t) { t.printStackTrace(); ok(false, "회색 render 예외"); }
        javax.imageio.ImageIO.write(gimg, "png", new java.io.File("btn_off.png"));
        com.dullyyj.kids.Poke.setCallOk(true);
        // 버튼 밖은 평소(위쪽 허공)
        ok(KidsActs.btnAt(c, c.W / 2, c.H / 2) < 0, "가운데는 버튼이 아니다");
        // 그리기: 예외 없이
        BufferedImage img = new BufferedImage((int) (c.PW * 1.5), (int) (c.PH * 1.5), BufferedImage.TYPE_INT_ARGB);
        java.awt.Graphics2D g = img.createGraphics();
        SceneCore c2 = c;
        try { c2.render(new AwtCv(g)); ok(true, "render 에 버튼이 같이 그려져도 예외 없다"); } catch (Throwable t) { t.printStackTrace(); ok(false, "render 예외"); }
        javax.imageio.ImageIO.write(img, "png", new java.io.File("btn.png"));
        System.out.println(fails == 0 ? "ALL OK" : fails + " FAIL");
        System.exit(fails == 0 ? 0 : 1);
    }
}
