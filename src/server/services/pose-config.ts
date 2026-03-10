import type { ProductCategory } from "../../shared/types";

export interface PoseTemplate {
  poseId: string;
  label: string;
  direction: string;
}

const commonStudioRules = [
  "formato cuadrado 1:1",
  "fotografia comercial premium y fotorealista",
  "iluminacion realista suave y controlada",
  "producto nitido y fiel en color, textura y detalles",
  "sin texto, sin watermark, sin tipografia",
  "evitar cortes incorrectos de manos o de la prenda",
  "mantener fondo limpio y sin elementos distractores que compitan con el producto",
  "mantener separacion visual clara entre producto y fondo",
  "mantener detalle visible en materiales oscuros y claros",
  "evitar reflejos o destellos molestos"
];

const categoryTemplates: Record<ProductCategory, PoseTemplate[]> = {
  parte_alta: [
    { poseId: "pose1", label: "Pose 1", direction: "encuadre hasta un cuarto de muslo, no cortar manos, actitud natural de catalogo" },
    { poseId: "pose2", label: "Pose 2", direction: "modelo completo con sugerencia de vestuario y actitud" },
    { poseId: "pose3", label: "Pose 3", direction: "acercamiento frontal a la prenda, mostrar labios arriba y terminar cerca de la prenda sin comprometer manos" },
    { poseId: "pose4", label: "Pose 4", direction: "vista posterior, cabeza casi de perfil, no cortar la prenda" }
  ],
  parte_baja: [
    { poseId: "pose1", label: "Pose 1", direction: "pose con actitud, incluir manos, ombligo como referencia arriba y prenda completa abajo; si parece pantalon incluir zapatos" },
    { poseId: "pose2", label: "Pose 2", direction: "modelo completo con sugerencia de vestuario y actitud" },
    { poseId: "pose3", label: "Pose 3", direction: "encuadre centrado en la prenda, usar el ombligo como referencia arriba, sin manos, prenda completa abajo; si parece pantalon incluir zapatos" },
    { poseId: "pose4", label: "Pose 4", direction: "vista posterior con parte de prenda superior visible y prenda completa abajo; si parece pantalon incluir zapatos" }
  ],
  vestido: [
    { poseId: "pose1", label: "Pose 1", direction: "vista frontal con actitud y lectura clara del vestido" },
    { poseId: "pose2", label: "Pose 2", direction: "modelo completo mostrando sugerencia de estilismo" },
    { poseId: "pose3", label: "Pose 3", direction: "acercamiento al vestido priorizando tela, caida y detalles" },
    { poseId: "pose4", label: "Pose 4", direction: "vista posterior completa del vestido" }
  ],
  interior_coordinado: [
    { poseId: "pose1", label: "Pose 1", direction: "vista frontal del conjunto con lectura clara de ambas piezas" },
    { poseId: "pose2", label: "Pose 2", direction: "pose alternativa con actitud manteniendo el conjunto totalmente visible" },
    { poseId: "pose3", label: "Pose 3", direction: "encuadre centrado al conjunto para destacar ajuste y detalles" },
    { poseId: "pose4", label: "Pose 4", direction: "vista posterior del conjunto" }
  ],
  interior_superior: [
    { poseId: "pose1", label: "Pose 1", direction: "vista frontal de la pieza superior" },
    { poseId: "pose2", label: "Pose 2", direction: "vista tres cuartos del torso mostrando soporte y forma" },
    { poseId: "pose3", label: "Pose 3", direction: "acercamiento frontal a la pieza superior" },
    { poseId: "pose4", label: "Pose 4", direction: "vista posterior de la pieza superior" }
  ],
  interior_inferior: [
    { poseId: "pose1", label: "Pose 1", direction: "vista frontal inferior limpia y centrada" },
    { poseId: "pose2", label: "Pose 2", direction: "vista tres cuartos con lectura clara del contorno" },
    { poseId: "pose3", label: "Pose 3", direction: "acercamiento que mantenga la pieza completa y visible" },
    { poseId: "pose4", label: "Pose 4", direction: "vista posterior de la prenda inferior" }
  ],
  producto_sin_modelo: [
    { poseId: "pose1", label: "Pose 1", direction: "frontal de catalogo sin modelo" },
    { poseId: "pose2", label: "Pose 2", direction: "toma lateral o tres cuartos sin modelo" },
    { poseId: "pose3", label: "Pose 3", direction: "detalle o toma abierta segun aplique" },
    { poseId: "pose4", label: "Pose 4", direction: "vista posterior sin modelo" }
  ]
};

export function getPoseTemplates(category: ProductCategory): PoseTemplate[] {
  return categoryTemplates[category];
}

export function getCommonStudioRules(): string[] {
  return [...commonStudioRules];
}
