package com.dullyyj.kids;

import android.content.Context;
import android.graphics.drawable.GradientDrawable;
import android.graphics.Typeface;
import android.util.TypedValue;
import android.widget.TextView;

final class Ui {
    private Ui() {}

    static float dp(Context c, float v) {
        return v * c.getResources().getDisplayMetrics().density;
    }

    static int dpi(Context c, float v) {
        return Math.round(dp(c, v));
    }

    static GradientDrawable box(Context c, int fill, float radiusDp, int stroke) {
        GradientDrawable g = new GradientDrawable();
        g.setColor(fill);
        g.setCornerRadius(dp(c, radiusDp));
        if (stroke != 0) g.setStroke(Math.max(1, Math.round(dp(c, 1f))), stroke);
        return g;
    }

    static TextView text(Context c, String s, float sp, int color, boolean bold) {
        TextView t = new TextView(c);
        t.setText(s);
        t.setTextSize(TypedValue.COMPLEX_UNIT_SP, sp);
        t.setTextColor(color);
        t.setTypeface(bold ? Typeface.DEFAULT_BOLD : Typeface.DEFAULT);
        t.setLineSpacing(0f, 1.15f);
        return t;
    }
}
