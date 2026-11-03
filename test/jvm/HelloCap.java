// 모이기 · 같이 놀기 뒤 4마리만 남는지 시험(s395) — 길동무 저장소의 장면 코드(SceneCore 등)에 kids-patch 를 끼워 JVM 에서 돌린다.
// 만드는 법: 길동무 native/shell 의 Scene*.java + test/java/AwtCv.java 를 src/com/dullyyj/subway 에, 이 저장소의 Poke · Wardrobe · Art · Dress 를 src/com/dullyyj/kids 에 복사하고
//   swaps.txt 를 적용 · KidsActs3.java.txt → KidsActs.java · KidsRooms → KidsRooms.java · KidsWear 는 빈 draw 로 대신한 뒤 javac, 이 파일의 클래스 이름은 HJ 로 바꿔 실행(class HelloCap → HJ).
package com.dullyyj.subway;

import java.awt.image.BufferedImage;
import java.util.*;

public class HJ {
    static int fails = 0;
    static void ok(boolean c, String n) { System.out.println((c ? "ok   " : "FAIL ") + n); if (!c) fails++; }
    static class H implements SceneCore.Host {
        final Map<String, SceneCv.Img> sheets = new HashMap<>(); SceneCv.Img intro;
        public SceneCv.Img sheet(String id) { return sheets.get(id); }
        public SceneCv.Img intro() { return intro; }
        public boolean ready() { return true; }
        public void haptic(String n) {}
        public void held() {}
    }
    static BufferedImage blank() { return new BufferedImage(1024, 1024, BufferedImage.TYPE_INT_ARGB); }
    static String[] IDS = {"ppopu", "dolsom", "lovel", "chaeng", "sul", "dudung", "bbosong", "juksun"};
    static SceneCore mk(int seed) {
        H h = new H();
        for (String id : SceneModel.ORDER) { h.sheets.put(id, new AwtCv.Img(blank())); h.sheets.put(id + "_pose", new AwtCv.Img(blank())); h.sheets.put(id + "_act", new AwtCv.Img(blank())); }
        h.intro = new AwtCv.Img(blank());
        SceneCore c = new SceneCore(h, new AwtCv(new BufferedImage(4, 4, BufferedImage.TYPE_INT_ARGB).createGraphics()), new SceneUtil.Seeded(seed));
        c.layout(340, 400, 1.5, false);
        StringBuilder cast = new StringBuilder();
        for (String id : IDS) cast.append(cast.length() > 0 ? "," : "").append('"').append(id).append('"');
        c.apply(SceneModel.parse("{\"ok\":true,\"mode\":\"idle\",\"hero\":\"\",\"cast\":[" + cast + "],\"look\":{\"place\":\"street\",\"slot\":\"noon\",\"wk\":\"clear\",\"season\":\"autumn\"}}"));
        return c;
    }
    static SceneHello.Plan plan() {
        SceneHello.Plan p = new SceneHello.Plan();
        int n = IDS.length; p.chars = IDS; p.sx = new double[n]; p.sz = new double[n]; p.order = new int[n];
        for (int i = 0; i < n; i++) { p.sx[i] = .1 + .8 * i / (n - 1); p.sz[i] = .4 + .4 * (i % 2); p.order[i] = i; p.say.put(IDS[i], "안녕"); }
        return p;
    }
    static void adv(SceneCore c, double sec) { for (int i = 0, n = (int) Math.round(sec * 60); i < n; i++) c.update(1.0 / 60); }
    static List<String> stay(SceneCore c) { List<String> r = new ArrayList<>(); for (SceneCore.Actor a : c.actors) if (!a.hero && !a.dead && !a.leaving && a.id != null) r.add(a.id); Collections.sort(r); return r; }

    public static void main(String[] x) {
        System.setProperty("java.awt.headless", "true");
        Set<String> kinds = new HashSet<>();
        for (int seed = 1; seed <= 6; seed++) {
            SceneCore c = mk(seed); adv(c, 8);
            SceneHello.Plan p = plan();
            boolean st = c.startHello(p, seed);
            if (seed == 1) ok(st, "hello starts");
            adv(c, p.leave / 1000.0 - 0.3);
            int gathered = stay(c).size();
            if (seed == 1) ok(gathered == 8, "all 8 gathered before leave (" + gathered + ")");
            adv(c, 0.6);                      // past leave
            List<String> after = stay(c);
            ok(after.size() == 4, "seed " + seed + ": 4 stay after hello leave -> " + after);
            kinds.add(after.toString());
            adv(c, 10);
            ok(stay(c).size() <= 4, "seed " + seed + ": still <=4 after 10s (" + stay(c).size() + ")");
        }
        ok(kinds.size() > 1, "kept set is random across seeds (" + kinds.size() + " variants)");
        // trim after play gather
        SceneCore c = mk(9); adv(c, 8);
        SceneHello.Plan p = plan(); c.startHello(p, 9); adv(c, 4.5); c.helloStop();           // 8 present, hello over without the leave step
        int on0 = stay(c).size();
        StringBuilder sb = new StringBuilder(";"); for (String id : IDS) sb.append(id).append(":play:0;");
        com.dullyyj.kids.Poke.setStates(sb.toString());
        adv(c, 5);
        ok(on0 == 8 && stay(c).size() == 8, "while playing all stay (" + on0 + "," + stay(c).size() + ")");
        sb = new StringBuilder(";"); for (String id : IDS) sb.append(id).append(":idle:0;");
        com.dullyyj.kids.Poke.setStates(sb.toString());
        adv(c, 1.0);
        ok(stay(c).size() == 8, "just after play ends still 8 (grace)");
        adv(c, 1.5);
        ok(stay(c).size() == 4, "after play ends -> 4 stay (" + stay(c).size() + ")");
        adv(c, 12);
        ok(stay(c).size() <= 4, "stays <=4 (" + stay(c).size() + ")");
        System.out.println(fails == 0 ? "ALL OK" : "FAILED " + fails);
        System.exit(fails == 0 ? 0 : 1);
    }
}
