package com.dirtybirds.companion.ui.theme

import android.os.Build
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.dynamicDarkColorScheme
import androidx.compose.material3.dynamicLightColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.platform.LocalContext

private val DarkColorScheme = darkColorScheme(
    primary = Pink80,
    secondary = PinkGrey80,
    tertiary = Rose80,
    background = SurfaceDark,
    surface = CardDark,
    onPrimary = SurfaceDark,
    onBackground = Pink80,
    onSurface = Pink80
)

private val LightColorScheme = lightColorScheme(
    primary = Pink40,
    secondary = PinkGrey40,
    tertiary = Rose40,
    background = SurfaceLight,
    surface = CardLight,
    onPrimary = CardLight,
    onBackground = PinkGrey40,
    onSurface = PinkGrey40
)

@Composable
fun CompanionTheme(
    darkTheme: Boolean = isSystemInDarkTheme(),
    dynamicColor: Boolean = true,
    content: @Composable () -> Unit
) {
    val colorScheme = when {
        dynamicColor && Build.VERSION.SDK_INT >= Build.VERSION_CODES.S -> {
            val context = LocalContext.current
            if (darkTheme) dynamicDarkColorScheme(context) else dynamicLightColorScheme(context)
        }
        darkTheme -> DarkColorScheme
        else -> LightColorScheme
    }

    MaterialTheme(
        colorScheme = colorScheme,
        typography = Typography,
        content = content
    )
}
