# Capa cinematográfica y audio

La versión v10.1 añade:

- Intro emergente en lenguaje sencillo que explica qué hace el simulador.
- Reproductor flotante con la playlist subida por el usuario.
- Intento de reproducción automática desde el primer momento.
- Botones para pausar, reproducir, avanzar y retroceder.
- Modo cinematográfico con 6 escenas para grabar el vídeo de YouTube.

## Nota sobre autoplay

La web intenta reproducir la música al cargar. Algunos navegadores bloquean audio con sonido hasta que el usuario toca/clica la página. Por eso aparece el botón **Entrar con música**. Si el navegador permite autoplay, sonará desde el inicio; si no, se desbloquea con ese primer clic.

## Archivos incluidos

Los MP3 están en:

```text
web/media/
```

Cloudflare Pages puede servirlos directamente junto al resto de la web.
