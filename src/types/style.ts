export type Style = "waseda" | "keio" | "chiba" | "unknown";

export type DiamondGuideLines = "present" | "absent";
export type BallCountBox = "left_vertical" | "top_horizontal";
export type FirstBasePosition = "bottom_right" | "top_right";
export type GroundoutPosition = "bottom_right_small" | "center_fraction";
export type ErrorSymbol = "E_prefix" | "prime_superscript";
export type BattingOrderStyle = "circled_digits" | "lowercase_latin";

export type StyleEvidence = {
  diamond_guide_lines: DiamondGuideLines;
  ball_count_box: BallCountBox;
  first_base_position: FirstBasePosition;
  groundout_position: GroundoutPosition;
  error_symbol: ErrorSymbol;
  batting_order_style: BattingOrderStyle;
};

export type StyleDetection = {
  style: Style;
  evidence: StyleEvidence;
  confidence: number;
};
