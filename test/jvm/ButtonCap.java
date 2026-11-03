// 장면 위 호출 버튼이 꺼졌는지 시험(s406) — 두 단추는 화면 아래 놀기 박스(Engine.callButtons)로 옮겼다. 장면의 아래 모서리를 눌러도 호출은 가지 않고, 그리기도 예외가 없다.
// 만드는 법은 test/jvm/HelloCap.java 머리말과 같다(클래스 이름 ButtonCap → HB).
package com.dullyyj.subway;
import java.awt.image.BufferedImage;
import java.util.*;
public class HB {
    static int fails = 0;
    static void ok(boolean c, String n) { System.out.println((c ? "ok   " : "FAIL ") + n); if (!c) fails++; }
    public static void main(String[] a) throws Exception {
        final List<String> calls = new ArrayList<>();
        com.dullyyj.kids.Poke.setCaller(w -> calls.add(w));
        com.dullyyj.kids.Poke.setCallOk(true);
        SceneCore c = HJ.mk(3);
        HJ.adv(c, 2);
        double k = c.k;
        double[] L = KidsActs.btnRect(c, 0), R = KidsActs.btnRect(c, 1);
        ok(KidsActs.btnAt(c, L[0] + L[2] / 2, L[1] + L[3] / 2) < 0 && KidsActs.btnAt(c, R[0] + R[2] / 2, R[1] + R[3] / 2) < 0, "아래 모서리는 더 이상 버튼이 아니다");
        c.down((L[0] + L[2] / 2) * k, (L[1] + L[3] / 2) * k); HJ.adv(c, .2); c.up();
        c.down((R[0] + R[2] / 2) * k, (R[1] + R[3] / 2) * k); HJ.adv(c, .2); c.up();
        ok(calls.isEmpty(), "모서리를 눌러도 arr · pick · off 가 가지 않는다");
        BufferedImage img = new BufferedImage((int) (c.PW * 1.5), (int) (c.PH * 1.5), BufferedImage.TYPE_INT_ARGB);
        try { c.render(new AwtCv(img.createGraphics())); ok(true, "render 예외 없다"); } catch (Throwable t) { t.printStackTrace(); ok(false, "render 예외"); }
        System.out.println(fails == 0 ? "ALL OK" : fails + " FAIL");
        System.exit(fails == 0 ? 0 : 1);
    }
}
