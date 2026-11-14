import React, { useState, useRef, useCallback, useMemo, memo } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  Modal,
  FlatList,
  StyleSheet,
  TouchableWithoutFeedback,
  ListRenderItemInfo,
  Platform,
} from 'react-native';
import { HARD_SHADOW, RETRO } from '../theme/retro';
import { placeDropdown } from '../utils/dropdownPlacement';

// Farben wie das Liga-Dropdown der Suchmaschine (Retro-Blau statt des alten Grüns, Matti 2026-11-14)

interface DropdownOption {
  value: string;
  label: string;
  /** Sammel-Eintrag (nur multiSelect): Häkchen wählt alle Einträge mit group = value, Pfeil klappt sie auf */
  isGroup?: boolean;
  /** gehört zu diesem Sammel-Eintrag, wird erst nach dem Aufklappen gezeigt */
  group?: string;
}

interface DropdownProps {
  options: DropdownOption[];
  value: string | string[];
  onChange: (value: string | string[]) => void;
  placeholder?: string;
  multiSelect?: boolean;
  label?: string;
  compact?: boolean;
}

export const Dropdown = memo<DropdownProps>(function Dropdown({
  options,
  value,
  onChange,
  placeholder = 'Auswählen...',
  multiSelect = false,
  label,
  compact = false,
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [dropdownPosition, setDropdownPosition] = useState({ top: 0, left: 0, minWidth: 220, maxWidth: 400 });
  const buttonRef = useRef<View>(null);

  const selectedValues = useMemo(
    () => Array.isArray(value) ? value : value ? [value] : [],
    [value]
  );

  const groupChildren = useCallback(
    (group: string) => options.filter(o => o.group === group).map(o => o.value),
    [options]
  );

  const displayText = useMemo(() => {
    if (selectedValues.length === 0) return placeholder;

    // Ganz gewählte Gruppe als ein Name ("Alle Regionalligen" statt fünf Einzelnamen)
    const labels: string[] = [];
    const covered = new Set<string>();
    for (const o of options) {
      if (o.isGroup) {
        const kids = groupChildren(o.value);
        if (kids.length > 0 && kids.every(k => selectedValues.includes(k))) {
          labels.push(o.label);
          kids.forEach(k => covered.add(k));
        }
      } else if (selectedValues.includes(o.value) && !covered.has(o.value)) {
        labels.push(o.label);
      }
    }
    for (const v of selectedValues) {
      if (!options.some(o => o.value === v)) labels.push(v);
    }
    return labels.join(', ');
  }, [selectedValues, options, placeholder, groupChildren]);

  const handleSelect = useCallback((optionValue: string) => {
    const opt = options.find(o => o.value === optionValue);
    if (multiSelect && opt?.isGroup) {
      // Sammel-Eintrag: alle an oder alle aus
      const currentValues = Array.isArray(value) ? value : [];
      const kids = groupChildren(optionValue);
      const allOn = kids.every(k => currentValues.includes(k));
      onChange(allOn ? currentValues.filter(v => !kids.includes(v)) : [...currentValues, ...kids.filter(k => !currentValues.includes(k))]);
      return;
    }
    if (multiSelect) {
      const currentValues = Array.isArray(value) ? value : [];
      if (currentValues.includes(optionValue)) {
        onChange(currentValues.filter(v => v !== optionValue));
      } else {
        onChange([...currentValues, optionValue]);
      }
    } else {
      onChange(optionValue);
      setIsOpen(false);
    }
  }, [multiSelect, value, onChange, options, groupChildren]);

  const toggleExpanded = useCallback((group: string) => {
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(group)) next.delete(group); else next.add(group);
      return next;
    });
  }, []);

  // Untereinträge nur bei aufgeklappter Gruppe
  const visibleOptions = useMemo(
    () => options.filter(o => !o.group || expanded.has(o.group)),
    [options, expanded]
  );

  const handleOpen = useCallback(() => {
    buttonRef.current?.measureInWindow((x, y, width, height) => {
      setDropdownPosition(placeDropdown(x, y, width, height, 220));
      setIsOpen(true);
    });
  }, []);

  const handleClose = useCallback(() => {
    setIsOpen(false);
  }, []);

  const isSelected = useCallback((optionValue: string) => {
    return selectedValues.includes(optionValue);
  }, [selectedValues]);

  const keyExtractor = useCallback((item: DropdownOption) => item.value, []);

  const renderItem = useCallback(({ item }: ListRenderItemInfo<DropdownOption>) => {
    const kids = item.isGroup ? groupChildren(item.value) : [];
    const kidsOn = kids.filter(k => selectedValues.includes(k)).length;
    const selected = item.isGroup ? kids.length > 0 && kidsOn === kids.length : selectedValues.includes(item.value);
    const partial = item.isGroup && kidsOn > 0 && !selected;
    return (
      <View style={[styles.option, item.group ? styles.optionChild : null]}>
        <TouchableOpacity style={styles.optionMain} onPress={() => handleSelect(item.value)}>
          {multiSelect && (
            <View style={[styles.checkbox, (selected || partial) && styles.checkboxOn]}>
              {selected && <Text style={styles.checkmark}>✓</Text>}
              {partial && <Text style={styles.checkmark}>−</Text>}
            </View>
          )}
          <Text style={[styles.optionText, !multiSelect && selected && styles.optionTextSelected]} numberOfLines={1}>
            {item.label}
          </Text>
        </TouchableOpacity>
        {item.isGroup && (
          <TouchableOpacity onPress={() => toggleExpanded(item.value)} hitSlop={8} style={styles.groupChevron}>
            <Text style={styles.groupChevronText}>{expanded.has(item.value) ? '▾' : '▸'}</Text>
          </TouchableOpacity>
        )}
      </View>
    );
  }, [selectedValues, multiSelect, handleSelect, groupChildren, expanded, toggleExpanded]);

  return (
    <View style={styles.container}>
      {label && (
        <Text style={styles.label}>{label}</Text>
      )}

      <TouchableOpacity
        ref={buttonRef}
        style={[
          styles.button,
          HARD_SHADOW,
          compact && styles.buttonCompact,
        ]}
        onPress={handleOpen}
        activeOpacity={0.7}
      >
        <Text
          style={[
            styles.buttonText,
            compact && styles.buttonTextCompact,
            { color: selectedValues.length > 0 ? RETRO.text : RETRO.textMuted },
          ]}
          numberOfLines={1}
        >
          {displayText}
        </Text>
        <Text style={styles.chevron}>
          {isOpen ? '▲' : '▼'}
        </Text>
      </TouchableOpacity>

      <Modal
        visible={isOpen}
        transparent
        animationType="none"
        onRequestClose={handleClose}
      >
        <TouchableWithoutFeedback onPress={handleClose}>
          <View style={styles.overlay}>
            <TouchableWithoutFeedback>
              <View
                style={[
                  styles.dropdown,
                  {
                    top: dropdownPosition.top,
                    left: dropdownPosition.left,
                    minWidth: dropdownPosition.minWidth,
                    maxWidth: dropdownPosition.maxWidth,
                  },
                ]}
              >
                {multiSelect && (
                  <TouchableOpacity style={styles.clearRow} onPress={() => onChange([])}>
                    <Text style={[styles.clearText, selectedValues.length > 0 && styles.clearTextActive]}>
                      Alle Häkchen entfernen
                    </Text>
                  </TouchableOpacity>
                )}
                <FlatList
                  data={visibleOptions}
                  extraData={expanded}
                  keyExtractor={keyExtractor}
                  renderItem={renderItem}
                  style={styles.optionList}
                />
                {multiSelect && (
                  <TouchableOpacity style={styles.doneButton} onPress={handleClose}>
                    <Text style={styles.doneButtonText}>
                      Fertig{selectedValues.length > 0 ? ` (${selectedValues.length})` : ''}
                    </Text>
                  </TouchableOpacity>
                )}
              </View>
            </TouchableWithoutFeedback>
          </View>
        </TouchableWithoutFeedback>
      </Modal>
    </View>
  );
});

Dropdown.displayName = 'Dropdown';

const styles = StyleSheet.create({
  container: {
    gap: 6,
  },
  label: {
    fontSize: 13,
    fontWeight: '600',
    color: RETRO.textMuted,
  },
  // randlos, weiß wie das Liga-Dropdown der Suche — Tiefe kommt vom HARD_SHADOW
  button: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderRadius: 0,
    backgroundColor: RETRO.inputBg,
    paddingHorizontal: 12,
    paddingVertical: 12,
    minHeight: 44,
  },
  buttonCompact: {
    paddingVertical: 3,
    paddingHorizontal: 8,
    minHeight: 24,
    minWidth: 52,
  },
  buttonText: {
    fontSize: 14,
    flex: 1,
  },
  buttonTextCompact: {
    fontSize: 13,
    flex: 1,
  },
  chevron: {
    fontSize: 10,
    marginLeft: 8,
    color: RETRO.textMuted,
  },
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.3)',
  },
  dropdown: {
    position: 'absolute',
    backgroundColor: RETRO.white,
    borderWidth: 1,
    borderColor: RETRO.shadowDark,
    borderRadius: 0,
    overflow: 'hidden',
    ...(Platform.OS === 'web'
      ? ({ boxShadow: '3px 3px 0px rgba(20, 20, 45, 0.55)' } as any)
      : { shadowColor: '#14142d', shadowOffset: { width: 3, height: 3 }, shadowOpacity: 0.55, shadowRadius: 0, elevation: 5 }),
  },
  optionList: {
    maxHeight: 320,
    // RN-Web rendert die Liste sonst mit overflow:hidden — Mausrad-Scroll erzwingen
    ...(Platform.OS === 'web' ? ({ overflowY: 'auto' } as any) : {}),
  },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingLeft: 12,
    paddingRight: 12,
  },
  optionChild: {
    paddingLeft: 36,
  },
  optionMain: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
  },
  checkbox: {
    width: 16,
    height: 16,
    borderRadius: 0,
    borderWidth: 1,
    borderColor: RETRO.shadowDark,
    marginRight: 10,
    justifyContent: 'center',
    alignItems: 'center',
  },
  checkboxOn: {
    backgroundColor: RETRO.headerBg,
    borderColor: RETRO.headerBg,
  },
  checkmark: {
    color: RETRO.white,
    fontSize: 11,
    fontWeight: '700',
    lineHeight: 15,
  },
  optionText: {
    fontSize: 13,
    fontWeight: '500',
    color: RETRO.text,
    flexShrink: 1,
  },
  optionTextSelected: {
    fontWeight: '700',
    color: RETRO.headerBg,
  },
  groupChevron: {
    paddingHorizontal: 8,
    paddingVertical: 10,
  },
  groupChevronText: {
    fontSize: 13,
    color: RETRO.textMuted,
  },
  clearRow: {
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: RETRO.rowBorder,
  },
  clearText: {
    fontSize: 13,
    fontWeight: '600',
    color: RETRO.textMuted,
  },
  clearTextActive: {
    color: '#b02020',
  },
  doneButton: {
    paddingVertical: 10,
    alignItems: 'center',
    backgroundColor: RETRO.headerBg,
  },
  doneButtonText: {
    fontSize: 14,
    fontWeight: '600',
    color: RETRO.white,
  },
});
