import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:punks/shared/theme/theme.dart';
import 'package:punks/shared/widgets/frosted_app_bar.dart';

void main() {
  group('Punks theme catalog entries', () {
    test('both halves are in the catalog', () {
      expect(findTheme(punksThemeName), isNotNull);
      expect(findTheme(punksDarkThemeName), isNotNull);
    });

    test('borrow the GitHub palettes', () {
      final punks = findTheme(punksThemeName)!;
      final github = findTheme('github-light')!;
      expect(punks.bg, github.bg);
      expect(punks.fg, github.fg);
      expect(punks.comment, github.comment);

      final punksDark = findTheme(punksDarkThemeName)!;
      final githubDark = findTheme('github-dark')!;
      expect(punksDark.bg, githubDark.bg);
      expect(punksDark.fg, githubDark.fg);
      expect(punksDark.comment, githubDark.comment);
    });

    test('are a light/dark pair', () {
      expect(findTheme(punksThemeName)!.isDark, isFalse);
      expect(findTheme(punksDarkThemeName)!.isDark, isTrue);
      expect(themePairFor(punksThemeName), punksDarkThemeName);
      expect(themePairFor(punksDarkThemeName), punksThemeName);
    });

    test('appear as a single System-mode option labelled "Punks"', () {
      final paired = themeGroups().paired.map((t) => t.name);
      expect(paired, contains(punksThemeName));
      expect(paired, isNot(contains(punksDarkThemeName)));
      expect(pairedThemeLabel(punksThemeName), 'Punks');
      expect(themeSelectionLabel(punksThemeName, ThemeMode.system), 'Punks');
      expect(themeSelectionLabel(punksDarkThemeName, ThemeMode.system), 'Punks');
    });

    test('forces neutral rendering without changing the stored accent', () {
      const storedAccent = '#ef4444';

      expect(
        effectiveAccentIndex(punksThemeName, storedAccent),
        neutralAccentIndex,
      );
      expect(
        effectiveAccentIndex(punksDarkThemeName, storedAccent),
        neutralAccentIndex,
      );
      expect(
        effectiveAccentIndex('github-light', storedAccent),
        accentIndexForWireValue(storedAccent),
      );
      expect(storedAccent, '#ef4444');
    });

    test('resolve across brightnesses like any other pair', () {
      final resolved = resolveSchemes(punksThemeName, ThemeMode.system);
      expect(resolved.forcedMode, isNull);
      expect(resolved.light.brightness, Brightness.light);
      expect(resolved.dark.brightness, Brightness.dark);
      expect(resolved.lightTheme?.name, punksThemeName);
      expect(resolved.darkTheme?.name, punksDarkThemeName);

      expect(
        effectiveTheme(punksThemeName, ThemeMode.dark)?.name,
        punksDarkThemeName,
      );
      expect(
        effectiveTheme(punksDarkThemeName, ThemeMode.light)?.name,
        punksThemeName,
      );
    });

    test(
      'fallbacks expose the effective Punks theme for gradient selection',
      () {
        final coerced = resolveSchemes('nord', ThemeMode.light);
        expect(coerced.lightTheme?.name, punksThemeName);
        expect(
          punksTopSectionGradient(
            coerced.lightTheme!.name,
            coerced.light.brightness,
          ),
          isNotNull,
        );

        final unknown = resolveSchemes('not-a-theme', ThemeMode.light);
        expect(unknown.lightTheme?.name, punksThemeName);
        expect(
          punksTopSectionGradient(
            unknown.lightTheme!.name,
            unknown.light.brightness,
          ),
          isNotNull,
        );
      },
    );
  });

  group('punksTopSectionGradient', () {
    test('is null for non-Punks themes', () {
      expect(punksTopSectionGradient('github-light', Brightness.light), isNull);
      expect(punksTopSectionGradient('nord', Brightness.dark), isNull);
    });

    test('paints top to bottom for both halves of the pair', () {
      for (final name in [punksThemeName, punksDarkThemeName]) {
        final gradient = punksTopSectionGradient(name, Brightness.light);
        expect(gradient, isNotNull, reason: '$name should be gradient-backed');
        expect(gradient!.begin, Alignment.topCenter);
        expect(gradient.end, Alignment.bottomCenter);
        expect(gradient.colors, hasLength(2));
      }
    });

    test('brightness selects the stops, not the theme name', () {
      // Both halves enable the gradient, so System mode keeps it on across an
      // OS switch — the applied brightness alone decides which stops are used.
      final light = punksTopSectionGradient(punksThemeName, Brightness.light)!;
      final dark = punksTopSectionGradient(punksThemeName, Brightness.dark)!;

      expect(light.colors, isNot(dark.colors));
      expect(
        punksTopSectionGradient(punksDarkThemeName, Brightness.dark)!.colors,
        dark.colors,
      );
      expect(
        punksTopSectionGradient(punksDarkThemeName, Brightness.light)!.colors,
        light.colors,
      );
    });

    test('is opaque so the color replaces the frosted fill', () {
      for (final brightness in Brightness.values) {
        final gradient = punksTopSectionGradient(punksThemeName, brightness)!;
        for (final color in gradient.colors) {
          expect(color.a, 1.0);
        }
      }
    });
  });

  group('theme threading', () {
    BoxDecoration barDecoration(WidgetTester tester) {
      final container = tester
          .widgetList<Container>(
            find.descendant(
              of: find.byType(FrostedAppBar),
              matching: find.byType(Container),
            ),
          )
          .first;
      return container.decoration! as BoxDecoration;
    }

    Widget harness(ThemeData theme) => MaterialApp(
      theme: theme,
      home: Builder(
        builder: (context) => Stack(
          children: [
            FrostedAppBar(
              gradient: context.appColors.topSectionGradient,
              title: const Text('Home'),
            ),
          ],
        ),
      ),
    );

    testWidgets('AppTheme carries the gradient to the top section', (
      tester,
    ) async {
      await tester.pumpWidget(
        harness(
          AppTheme.light(
            topSectionGradient: punksTopSectionGradient(
              punksThemeName,
              Brightness.light,
            ),
          ),
        ),
      );

      final decoration = barDecoration(tester);
      expect(decoration.gradient, isNotNull);
      // A BoxDecoration cannot paint a color and a gradient at once.
      expect(decoration.color, isNull);
    });

    testWidgets('non-Punks themes keep the frosted surface fill', (
      tester,
    ) async {
      await tester.pumpWidget(harness(AppTheme.light()));

      final decoration = barDecoration(tester);
      expect(decoration.gradient, isNull);
      expect(decoration.color, isNotNull);
    });

    testWidgets('Punks section labels use 80% neutral foreground', (
      tester,
    ) async {
      await tester.pumpWidget(
        harness(
          AppTheme.light(
            topSectionGradient: punksTopSectionGradient(
              punksThemeName,
              Brightness.light,
            ),
          ),
        ),
      );

      final context = tester.element(find.text('Home'));
      expect(
        navigationSectionForeground(context),
        Colors.black.withValues(alpha: 0.8),
      );
    });

    testWidgets('navigation roles inherit non-Punks theme tokens', (
      tester,
    ) async {
      const primaryForeground = Color(0xFF123456);
      const secondaryForeground = Color(0xFF789ABC);
      const searchSurface = Color(0xFFDEF012);
      final theme = ThemeData(
        colorScheme: ColorScheme.fromSeed(seedColor: Colors.purple).copyWith(
          onSurface: primaryForeground,
          onSurfaceVariant: secondaryForeground,
          surfaceContainerHighest: searchSurface,
        ),
      );

      await tester.pumpWidget(
        MaterialApp(
          theme: theme,
          home: const Scaffold(body: SizedBox()),
        ),
      );

      final context = tester.element(find.byType(SizedBox));
      expect(navigationPrimaryForeground(context), primaryForeground);
      expect(navigationSecondaryForeground(context), secondaryForeground);
      expect(navigationSectionForeground(context), secondaryForeground);
      expect(navigationSearchSurface(context), searchSurface);
      expect(
        navigationDivider(context, 0.15),
        primaryForeground.withValues(alpha: 0.15),
      );
    });
  });

  group('isPunksTheme', () {
    test('matches only the Punks pair', () {
      expect(isPunksTheme(punksThemeName), isTrue);
      expect(isPunksTheme(punksDarkThemeName), isTrue);
      expect(isPunksTheme('github-light'), isFalse);
      expect(isPunksTheme(''), isFalse);
    });
  });
}
