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
import { useTheme } from '../contexts/ThemeContext';
import { HARD_SHADOW } from '../theme/retro';

interface DropdownOption {
  value: string;
  label: string;
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
  const { colors } = useTheme();
  const [isOpen, setIsOpen] = useState(false);
  const [dropdownPosition, setDropdownPosition] = useState({ top: 0, left: 0, width: 0 });
  const buttonRef = useRef<View>(null);

  const selectedValues = useMemo(
    () => Array.isArray(value) ? value : value ? [value] : [],
    [value]
  );

  const displayText = useMemo(() => {
    if (selectedValues.length === 0) return placeholder;

    const selectedLabels = selectedValues
      .map(v => options.find(o => o.value === v)?.label || v)
      .join(', ');

    return selectedLabels;
  }, [selectedValues, options, placeholder]);

  const handleSelect = useCallback((optionValue: string) => {
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
  }, [multiSelect, value, onChange]);

  const handleOpen = useCallback(() => {
    buttonRef.current?.measureInWindow((x, y, width, height) => {
      setDropdownPosition({
        top: y + height + 4,
        left: x,
        width: width,
      });
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
    const selected = selectedValues.includes(item.value);
    return (
      <TouchableOpacity
        style={[
          styles.option,
          {
            backgroundColor: selected
              ? colors.primary + '20'
              : 'transparent',
          },
        ]}
        onPress={() => handleSelect(item.value)}
      >
        {multiSelect && (
          <View
            style={[
              styles.checkbox,
              {
                borderColor: selected
                  ? colors.primary
                  : colors.border,
                backgroundColor: selected
                  ? colors.primary
                  : 'transparent',
              },
            ]}
          >
            {selected && (
              <Text style={styles.checkmark}>✓</Text>
            )}
          </View>
        )}
        <Text
          style={[
            styles.optionText,
            {
              color: selected
                ? colors.primary
                : colors.text,
              fontWeight: selected ? '600' : '400',
            },
          ]}
        >
          {item.label}
        </Text>
      </TouchableOpacity>
    );
  }, [selectedValues, colors, multiSelect, handleSelect]);

  return (
    <View style={styles.container}>
      {label && (
        <Text style={[styles.label, { color: colors.textSecondary }]}>{label}</Text>
      )}

      <TouchableOpacity
        ref={buttonRef}
        style={[
          styles.button,
          HARD_SHADOW,
          {
            // graue Retro-Fläche wie die übrigen Buttons, randlos
            backgroundColor: colors.surfaceSecondary,
          },
          compact && styles.buttonCompact,
        ]}
        onPress={handleOpen}
        activeOpacity={0.7}
      >
        <Text
          style={[
            styles.buttonText,
            compact && styles.buttonTextCompact,
            {
              color: selectedValues.length > 0 ? colors.text : colors.textSecondary,
            },
          ]}
          numberOfLines={1}
        >
          {displayText}
        </Text>
        <Text style={[styles.chevron, { color: colors.textSecondary }]}>
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
                    backgroundColor: colors.surface,
                    borderColor: colors.border,
                    top: dropdownPosition.top,
                    left: dropdownPosition.left,
                    minWidth: Math.max(dropdownPosition.width, 200),
                    maxHeight: 250,
                  },
                ]}
              >
                <FlatList
                  data={options}
                  keyExtractor={keyExtractor}
                  renderItem={renderItem}
                  style={styles.optionList}
                />
                {multiSelect && selectedValues.length > 0 && (
                  <TouchableOpacity
                    style={[styles.doneButton, { backgroundColor: colors.primary }]}
                    onPress={handleClose}
                  >
                    <Text style={[styles.doneButtonText, { color: colors.primaryText }]}>
                      Fertig ({selectedValues.length})
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
  },
  button: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderRadius: 2, // Anstoss-Optik: eckig, randlos
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
  },
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.3)',
  },
  dropdown: {
    position: 'absolute',
    borderWidth: 1,
    borderRadius: 2, // Anstoss-Optik: eckig
    ...(Platform.OS === 'web'
      ? ({ boxShadow: '2px 2px 3px rgba(20, 20, 45, 0.45)' } as any)
      : {
          shadowColor: '#14142d',
          shadowOffset: { width: 2, height: 2 },
          shadowOpacity: 0.45,
          shadowRadius: 2,
          elevation: 5,
        }),
    overflow: 'hidden',
  },
  optionList: {
    maxHeight: 200,
    // RN-Web rendert die Liste sonst mit overflow:hidden — Mausrad-Scroll erzwingen
    ...(Platform.OS === 'web' ? ({ overflowY: 'auto' } as any) : {}),
  },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  checkbox: {
    width: 18,
    height: 18,
    borderRadius: 2, // eckig
    borderWidth: 2,
    marginRight: 10,
    justifyContent: 'center',
    alignItems: 'center',
  },
  checkmark: {
    color: '#fff',
    fontSize: 11,
    fontWeight: '700',
  },
  optionText: {
    fontSize: 14,
    flexShrink: 1,
  },
  doneButton: {
    margin: 8,
    paddingVertical: 8,
    borderRadius: 2, // eckig
    alignItems: 'center',
  },
  doneButtonText: {
    fontSize: 14,
    fontWeight: '600',
  },
});
