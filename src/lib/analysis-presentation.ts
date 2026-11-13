export function analysisPresentation(progress: number, elapsedSeconds = 0) {
  if (progress >= 100) {
    return {
      title: "¡Análisis completado al 100%!",
      description: "Tu calendario semestral está listo",
      message: "¡Listo! Revisa y edita las fechas antes de exportar",
      image: "/syllabot_06_celebrando.png",
    };
  }
  if (progress >= 95) {
    return {
      title: "Generando tu calendario...",
      description: "Preparando todas tus evaluaciones para revisarlas",
      message: "¡Casi listo! Generando tu calendario...",
      image: "/syllabot_05_calendario.png",
    };
  }
  if (progress >= 90) {
    return {
      title: "Sanitizando exámenes y prácticas...",
      description: "Organizando parciales, finales y entregables",
      message: "Organizando exámenes, prácticas y ponderaciones...",
      image: "/syllabot_03_pulgar_arriba.png",
    };
  }
  if (progress >= 75) {
    return {
      title: "Analizando cronograma...",
      description: "Identificando parciales, finales y entregables",
      message: "Analizando evaluaciones y fechas...",
      image: "/syllabot_04_pensando.png",
    };
  }
  if (progress >= 65) {
    return {
      title: "Identificando tus evaluaciones...",
      description: "Buscando las fechas importantes de tu semestre",
      message: "Ya leí tu sílabo. Estoy ordenando las evaluaciones...",
      image: "/syllabot_04_pensando.png",
    };
  }
  if (progress > 0) {
    return {
      title: "Extrayendo texto del sílabo...",
      description: "Leyendo el contenido y el cronograma de tu curso",
      message: "Extrayendo el texto de tu sílabo...",
      image: "/syllabot_04_pensando.png",
    };
  }
  return {
    title: elapsedSeconds >= 15 ? "Preparando el análisis..." : "Recibiendo tu sílabo...",
    description:
      elapsedSeconds >= 15
        ? "El inicio está tardando un poco. Seguimos esperando tu análisis."
        : "Enseguida comenzaré a leer las fechas de tu curso",
    message:
      elapsedSeconds >= 15
        ? "Estoy despertando para organizar tu semestre. ¡Gracias por esperar!"
        : "¡Vamos a organizar tu semestre! Estoy recibiendo tu sílabo...",
    image: elapsedSeconds >= 15 ? "/syllabot_07_durmiendo.png" : "/syllabot_04_pensando.png",
  };
}
