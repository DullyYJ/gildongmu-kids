package com.dullyyj.kids;

import android.app.Activity;
import android.app.Dialog;
import android.content.DialogInterface;
import android.graphics.Color;
import android.graphics.drawable.ColorDrawable;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.view.Window;
import android.widget.LinearLayout;
import android.widget.TextView;

/**
 * 앱 테마(둥근 카드 · 알약 단추 · 앱 글꼴)에 맞춘 안내 창 — 안전 도착 · 데리러 와줘 · 긴급 호출 같은 확인 창에 쓴다.
 * 시스템 기본 창(AlertDialog)을 대신한다. 눌린 단추는 창을 먼저 닫고 할 일을 한다.
 */
final class Pop {
    /** 단추 모양: 주(금색 바탕) · 보통(테두리) · 긴급(주황 글자 · 119). */
    static final int MAIN = 0, PLAIN = 1, ALERT = 2;

    static final class Btn {
        final String label;
        final int style;
        final Runnable run;

        Btn(String label, int style, Runnable run) {
            this.label = label;
            this.style = style;
            this.run = run;
        }
    }

    static final class Win {
        final Dialog dialog;
        final TextView msg;

        Win(Dialog d, TextView m) {
            dialog = d;
            msg = m;
        }

        void setMessage(String s) {
            msg.setText(s);
        }

        void dismiss() {
            try {
                dialog.dismiss();
            } catch (Throwable ignored) {
                // 이미 닫혔다
            }
        }

        void onDismiss(final Runnable r) {
            dialog.setOnDismissListener(new DialogInterface.OnDismissListener() {
                @Override
                public void onDismiss(DialogInterface di) {
                    r.run();
                }
            });
        }
    }

    private Pop() {
    }

    static Win show(final Activity a, String title, String message, boolean cancelable, Btn... btns) {
        final Dialog d = new Dialog(a, android.R.style.Theme_Material_Light_Dialog_NoActionBar);
        LinearLayout box = new LinearLayout(a);
        box.setOrientation(LinearLayout.VERTICAL);
        int pad = Ui.dpi(a, 20);
        box.setPadding(pad, Ui.dpi(a, 20), pad, Ui.dpi(a, 16));
        box.setBackground(Ui.box(a, Pal.c(Pal.BG), 24, Pal.c(Pal.BORDER)));
        TextView t = Ui.text(a, title, 17f, Pal.c(Pal.TEXT), true);
        box.addView(t, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));
        final TextView m = Ui.text(a, message, 13f, Pal.c(Pal.SUB), false);
        m.setLineSpacing(0f, 1.25f);
        LinearLayout.LayoutParams ml = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        ml.topMargin = Ui.dpi(a, 8);
        box.addView(m, ml);
        LinearLayout row = new LinearLayout(a);
        row.setOrientation(LinearLayout.HORIZONTAL);
        row.setGravity(Gravity.END | Gravity.CENTER_VERTICAL);
        for (final Btn b : btns) {
            TextView p = Ui.text(a, b.label, 13f, b.style == MAIN ? Pal.c(Pal.ONGOLD) : b.style == ALERT ? Pal.c(Pal.ORANGE) : Pal.c(Pal.TEXT), true);
            p.setGravity(Gravity.CENTER);
            int ph = Ui.dpi(a, 16), pv = Ui.dpi(a, 9);
            p.setPadding(ph, pv, ph, pv);
            p.setBackground(b.style == MAIN ? Ui.box(a, Pal.c(Pal.GOLD), 20, 0) : Ui.box(a, Pal.c(Pal.CARD2), 20, b.style == ALERT ? Pal.c(Pal.ORANGE) : Pal.c(Pal.BORDER)));
            p.setOnClickListener(new View.OnClickListener() {
                @Override
                public void onClick(View v) {
                    try {
                        d.dismiss();
                    } catch (Throwable ignored) {
                        // 이미 닫혔다
                    }
                    if (b.run != null) b.run.run();
                }
            });
            LinearLayout.LayoutParams pl = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT);
            pl.leftMargin = Ui.dpi(a, 8);
            row.addView(p, pl);
        }
        LinearLayout.LayoutParams rl = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        rl.topMargin = Ui.dpi(a, 16);
        box.addView(row, rl);
        d.setContentView(box);
        d.setCancelable(cancelable);
        d.setCanceledOnTouchOutside(cancelable);
        Window w = d.getWindow();
        if (w != null) {
            w.setBackgroundDrawable(new ColorDrawable(Color.TRANSPARENT));          // 둥근 카드 뒤 네모난 바탕이 비치지 않게
            int width = Math.min(a.getResources().getDisplayMetrics().widthPixels - Ui.dpi(a, 40), Ui.dpi(a, 360));
            w.setLayout(width, ViewGroup.LayoutParams.WRAP_CONTENT);
        }
        d.show();
        return new Win(d, m);
    }
}
