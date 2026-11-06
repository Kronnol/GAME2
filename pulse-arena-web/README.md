# ⚡ PULSE ARENA — juego web competitivo

Juego original, completamente funcional y editable, hecho con **HTML, CSS, JavaScript y Node.js**. No depende de motores de juego, bases de datos ni paquetes de NPM. Funciona en navegadores modernos de escritorio y móvil.

## Cómo ejecutarlo en Visual Studio Code (Windows / macOS / Linux)

1. Instala **Node.js 18 o superior** desde https://nodejs.org (si todavía no lo tienes).
2. Descomprime `PULSE-ARENA.zip` y abre la carpeta `pulse-arena-web` en Visual Studio Code (Archivo > Abrir carpeta).
3. Abre la terminal integrada (Terminal > Nueva terminal).
4. Escribe:

   ```bash
   npm start
   ```

   O directamente `node server.js`.

**Atajo para Windows:** también puedes abrir `INICIAR_JUEGO.bat` con doble clic. Este archivo inicia el servidor y abre el navegador automáticamente (requiere Node.js instalado).
5. Abre **http://localhost:3000** en Chrome, Edge, Firefox o Safari.

> No hace falta `npm install`: el proyecto usa solo módulos integrados de Node.js.

## Cómo se juega

- **WASD / flechas**: mover el personaje por el mapa.
- **Espacio / clic izquierdo / E**: lanzar un pulso. Roba puntos a los rivales cercanos (radio de 180 unidades); también atrae esferas cercanas si no golpea a nadie. Enfriamiento: 6,4 segundos.
- **Shift**: dash, impulso rápido de movimiento con invulnerabilidad breve. Enfriamiento: 4,6 segundos.
- **Móvil**: joystick táctil, más botones de pulso y dash.
- **Esferas turquesa**: energía normal; **moradas**: energía rara; **doradas**: legendarias.
- **Combos**: recoge esferas con menos de 3,2 segundos entre una y otra para crear una cadena de hasta 12 recogidas y aumentar la bonificación de puntuación (hasta 2,3×).
- **Potenciadores**: escudo azul, velocidad rosa e imán amarillo.
- Gana quien tenga más puntos al finalizar los **105 segundos**. Tras ver los resultados comienza otra ronda automáticamente.

## Multijugador real

El juego utiliza una conexión WebSocket y el servidor mantiene las posiciones, la puntuación y las colisiones. Al entrar a `PUBLIC`, coincides con otras personas conectadas al **mismo servidor**. También puedes pulsar **CREAR SALA PRIVADA** y compartir el código de sala.

### Jugar con amigos conectados al mismo Wi-Fi (LAN)

1. Inicia `npm start` en tu PC.
2. Busca la dirección IPv4 local de tu PC con `ipconfig` (Windows) o `ip a` / `ifconfig` (Linux/macOS).
3. Abre desde otro dispositivo en la misma red: `http://TU-IP-LOCAL:3000` (por ejemplo: `http://192.168.1.20:3000`).
4. Permite las conexiones entrantes en el firewall si Windows pregunta.
5. Usa la sala pública o crea una privada y comparte el código/link.

**Para jugar por Internet con personas fuera de tu red**, despliega este proyecto en un servidor Node.js público que soporte WebSockets y que tenga HTTPS (para usar WSS). Por ejemplo, puedes alojar el repositorio en un hosting compatible con Node.js y WebSockets. Una conexión local `localhost` NO es accesible desde Internet por sí misma. `HOST` y `PORT` se pueden configurar mediante variables de entorno.

## Récords

Al finalizar cada ronda, los tres mejores récords históricos aparecen en la pantalla de resultados y el servidor guarda los mejores resultados **de jugadores humanos** en `leaderboard.json`, por apodo. Los robots no quedan registrados. Es un récord **local de ese servidor**, no una clasificación mundial. Se conserva mientras el archivo y el servidor se conserven; al crear un despliegue nuevo sin almacenamiento persistente podría reiniciarse. El sistema no requiere una cuenta; por tanto, no constituye una clasificación competitiva verificada ni protegida contra el robo de apodos.

## Dónde editar cada parte

| Archivo | Qué puedes modificar |
| --- | --- |
| `public/index.html` | Interfaz, textos, menús, paneles y botones. |
| `public/styles.css` | Colores, animaciones, estilo responsive y efectos neón. |
| `public/game.js` | Renderizado Canvas, controles, sonido y partículas. |
| `server.js` | Duración, reglas, IA de bots, puntuación, habilidades, salas, esferas, récords y lógica multijugador. |
| `public/favicon.svg` | Icono del navegador. |

### Personalizaciones rápidas

- **Duración**: `ROUND_MS` en `server.js` (milisegundos).
- **Tamaño del mapa**: `WIDTH`, `HEIGHT`.
- **Cantidad/nombres de rivales IA**: `BOT_NAMES`.
- **Tiempo de reutilización de habilidades**: `p.pulseCd = now + 6400` y `p.dashCd = now + 4600`.
- **Colores del menú**: variables CSS `:root`.
- **Puntos**: `collectOrb()`.
- **Nivel de dificultad**: velocidad de los bots en `movePlayer()` y su toma de decisiones en `botLogic()`.

## Ideas para próximas versiones

Cuentas con login, torneo semanal, emparejamiento por habilidad, mapas alternativos, skins desbloqueables, modo espectador, sonidos originales y tablas globales con anti-trampas.

**Proyecto educativo y jugable.** Si planeas publicarlo comercialmente a gran escala, añade autenticación, seguridad adicional, control de abuso/rate-limits, escalabilidad del servidor y almacenamiento persistente externo.
