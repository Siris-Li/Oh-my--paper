import { useState } from "react";
import { weaponSvg, BUILTIN_SKILLS } from "../lib/weaponPixels";
import type { AcademicSkill, SkillManifest } from "../types";

interface SkillArsenalProps {
  skills: SkillManifest[];
  onToggleSkill: (skill: SkillManifest) => Promise<void>;
  onSkillAction?: (skill: AcademicSkill) => void;
  compact?: boolean;
}

export function SkillArsenal({ skills, onToggleSkill, onSkillAction, compact = false }: SkillArsenalProps) {
  const [pending, setPending] = useState<string | null>(null);

  const mappedSkills: AcademicSkill[] = skills.map((manifest) => {
    const enabled = manifest.isEnabled ?? manifest.enabled ?? false;
    const builtin = BUILTIN_SKILLS.find((b) => b.id === manifest.id);
    if (builtin) return { ...builtin, enabled };
    return {
      id: manifest.id,
      name: manifest.name ?? manifest.id,
      description: "",
      weaponType: "blade" as const,
      themeColors: { primary: "#7c6f9f", secondary: "#3a3550", accent: "#c9b8ff" },
      actionLabel: "Use",
      enabled,
      isCustom: true,
    };
  });

  const isActive = (manifest: SkillManifest) =>
    manifest.isEnabled ?? manifest.enabled ?? false;

  const handleCardClick = async (skill: AcademicSkill) => {
    const manifest = skills.find((s) => s.id === skill.id);
    if (!manifest || pending === skill.id) return;
    setPending(skill.id);
    try {
      await onToggleSkill(manifest);
    } finally {
      setPending(null);
    }
  };

  const handleAction = (e: React.MouseEvent, skill: AcademicSkill) => {
    e.stopPropagation();
    onSkillAction?.(skill);
  };

  return (
    <div className={`arsenal ${compact ? "arsenal--compact" : ""}`}>
      <div className="arsenal-grid">
        {mappedSkills.map((skill, index) => {
          const manifest = skills.find((s) => s.id === skill.id);
          const active = manifest ? isActive(manifest) : false;
          const iconSize = compact ? 32 : 48;
          const svg = weaponSvg(skill.weaponType, iconSize, skill.themeColors.primary, skill.themeColors.accent);

          return (
            <div
              key={skill.id}
              className={`arsenal-card arsenal-card-enter${active ? " arsenal-card--active" : ""}`}
              style={{
                animationDelay: `${index * 80}ms`,
                "--arsenal-primary": skill.themeColors.primary,
                "--arsenal-secondary": skill.themeColors.secondary,
                "--arsenal-accent": skill.themeColors.accent,
              } as React.CSSProperties}
              onClick={() => handleCardClick(skill)}
            >
              <div className="arsenal-icon" dangerouslySetInnerHTML={{ __html: svg }} />
              <span className="arsenal-name">{skill.name}</span>
              {!compact && <span className="arsenal-desc">{skill.description}</span>}
              <button
                className="arsenal-action-btn"
                onClick={(e) => handleAction(e, skill)}
              >
                {skill.actionLabel}
              </button>
              {skill.isCustom && <span className="arsenal-custom-dot" />}
            </div>
          );
        })}
      </div>
    </div>
  );
}
