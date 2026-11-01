package com.dullyyj.kids;

import android.graphics.Bitmap;

/** 3D 로 그려 둔 입을 것 그림 시트(assets/wear/<친구>.webp)를 받아 온다. 읽히기 전에는 null(그림 문장으로 대신 그린다). 홈 장면(KidsWear)에서도 쓴다. */
public final class WearImg {
    private WearImg() {}

    /** 친구 번호의 시트(8x8칸 × 192px). 아직 읽는 중이거나 없으면 null. 읽는 일은 뒤 스레드에서 한다. */
    public static Bitmap atlas(int ci) {
        if (ci < 0 || ci >= Wardrobe.IDS.length || Core.sheets == null) return null;
        return Core.sheets.get("wear_" + Wardrobe.IDS[ci], null);
    }

    /** 몸에 입혀 구운 옷 한 벌의 시트(assets/wear/<친구>_g<옷 번호>.webp). 아직 읽는 중이거나 없으면 null. */
    public static Bitmap worn(int ci, int i) {
        if (ci < 0 || ci >= Wardrobe.IDS.length || i < 0 || i >= Wardrobe.PER || Core.sheets == null) return null;
        return Core.sheets.get("wear_" + Wardrobe.IDS[ci] + "_g" + i, null);
    }
}
