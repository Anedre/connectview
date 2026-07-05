/* El build "light" de lottie-web (solo SVG, sin canvas/html renderers) no
   trae su propia declaración — reutiliza los tipos del entry principal. */
declare module "lottie-web/build/player/lottie_light" {
  import lottie from "lottie-web";
  export default lottie;
}
