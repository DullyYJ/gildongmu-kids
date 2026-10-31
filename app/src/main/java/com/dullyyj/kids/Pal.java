package com.dullyyj.kids;

/** 색 역할 14개 — 길동무 ShellCore.palette 와 같은 값·같은 순서. 테마 이름도 같다(dark / pastel). */
final class Pal {
    static final int BG = 0, CARD = 1, BORDER = 2, TEXT = 3, SUB = 4, GOLD = 5, ORANGE = 6, IMGBG = 7,
            WHITE = 8, BORDER2 = 9, CARD2 = 10, NAV = 11, GOLD2 = 12, ONGOLD = 13;

    static final int[] DARK = {
        0xFF121214, 0xFF1C1C1E, 0xFF2C2C2E, 0xFFF2F2F7, 0xFF8E8E93, 0xFFD4AF37, 0xFFFF9F0A,
        0xFF252528, 0xFFFFFFFF, 0xFF3A3A3C, 0xFF2C2C2E, 0xFF1C1C1E, 0xFFB8922F, 0xFF121214
    };
    static final int[] PASTEL = {
        0xFFF0F4F8, 0xFFFFFFFF, 0xFFDCE8F0, 0xFF1A2533, 0xFF6B8299, 0xFF1D9BF0, 0xFFF07830,
        0xFFE8F4FF, 0xFFFFFFFF, 0xFFC8DCEA, 0xFFE8F0F8, 0xFFFFFFFF, 0xFF0E7DD6, 0xFFFFFFFF
    };

    static int[] cur = PASTEL;
    static boolean dark = false;

    private Pal() {}

    static void set(String theme) {
        dark = "dark".equals(theme);
        cur = dark ? DARK : PASTEL;
    }

    static int c(int role) {
        return cur[role];
    }
}
