import 'package:flutter/material.dart';

/// DukaFlow design tokens — mirrored from the web design system.
abstract final class DukaColors {
  static const primary = Color(0xFF0052CC);
  static const primaryDark = Color(0xFF0747A6);
  static const primaryLight = Color(0xFFE9F2FF);
  static const success = Color(0xFF00C853);
  static const successLight = Color(0xFFE8F5E9);
  static const danger = Color(0xFFFF5630);
  static const dangerLight = Color(0xFFFFEBEE);
  static const warning = Color(0xFFFFAB00);
  static const warningLight = Color(0xFFFFF8E1);
  static const ink = Color(0xFF172B4D);
  static const inkMuted = Color(0xFF6B778C);
  static const border = Color(0xFFDFE1E6);
  static const canvas = Color(0xFFF4F5F7);
  static const surface = Color(0xFFFAFBFC);
  static const white = Color(0xFFFFFFFF);
}

class DukaTheme {
  static ThemeData get light => ThemeData(
        useMaterial3: true,
        colorScheme: ColorScheme.fromSeed(
          seedColor: DukaColors.primary,
          primary: DukaColors.primary,
          secondary: DukaColors.success,
          error: DukaColors.danger,
          surface: DukaColors.white,
        ),
        scaffoldBackgroundColor: DukaColors.canvas,
        appBarTheme: const AppBarTheme(
          backgroundColor: DukaColors.primary,
          foregroundColor: DukaColors.white,
          elevation: 0,
          centerTitle: false,
          titleTextStyle: TextStyle(
            color: DukaColors.white,
            fontSize: 18,
            fontWeight: FontWeight.w700,
          ),
        ),
        cardTheme: CardTheme(
          color: DukaColors.white,
          elevation: 0,
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(16),
            side: const BorderSide(color: DukaColors.border),
          ),
          margin: EdgeInsets.zero,
        ),
        elevatedButtonTheme: ElevatedButtonThemeData(
          style: ElevatedButton.styleFrom(
            backgroundColor: DukaColors.primary,
            foregroundColor: DukaColors.white,
            minimumSize: const Size(44, 48),
            shape: RoundedRectangleBorder(
              borderRadius: BorderRadius.circular(12),
            ),
            textStyle: const TextStyle(fontWeight: FontWeight.w700, fontSize: 15),
          ),
        ),
        outlinedButtonTheme: OutlinedButtonThemeData(
          style: OutlinedButton.styleFrom(
            foregroundColor: DukaColors.primary,
            minimumSize: const Size(44, 48),
            side: const BorderSide(color: DukaColors.primary),
            shape: RoundedRectangleBorder(
              borderRadius: BorderRadius.circular(12),
            ),
          ),
        ),
        filledButtonTheme: FilledButtonThemeData(
          style: FilledButton.styleFrom(
            minimumSize: const Size(44, 48),
            shape: RoundedRectangleBorder(
              borderRadius: BorderRadius.circular(12),
            ),
          ),
        ),
        inputDecorationTheme: InputDecorationTheme(
          filled: true,
          fillColor: DukaColors.white,
          border: OutlineInputBorder(
            borderRadius: BorderRadius.circular(12),
            borderSide: const BorderSide(color: DukaColors.border),
          ),
          enabledBorder: OutlineInputBorder(
            borderRadius: BorderRadius.circular(12),
            borderSide: const BorderSide(color: DukaColors.border),
          ),
          focusedBorder: OutlineInputBorder(
            borderRadius: BorderRadius.circular(12),
            borderSide: const BorderSide(color: DukaColors.primary, width: 2),
          ),
          contentPadding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
        ),
        chipTheme: ChipThemeData(
          backgroundColor: DukaColors.surface,
          side: const BorderSide(color: DukaColors.border),
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(999),
          ),
        ),
        snackBarTheme: const SnackBarThemeData(
          behavior: SnackBarBehavior.floating,
          backgroundColor: DukaColors.ink,
          contentTextStyle: TextStyle(color: DukaColors.white),
        ),
        tabBarTheme: const TabBarTheme(
          labelColor: DukaColors.primary,
          unselectedLabelColor: DukaColors.inkMuted,
          indicatorColor: DukaColors.primary,
        ),
      );
}
