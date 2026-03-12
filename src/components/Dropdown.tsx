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
} from 'react-native';
import { useTheme } from '../contexts/ThemeContext';

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
          {
            backgroundColor: colors.inputBackground,
            borderColor: isOpen ? colors.primary : colors.inputBorder,
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
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 12,
    minHeight: 44,
  },
  buttonCompact: {
    paddingVertical: 6,
    paddingHorizontal: 10,
    minHeight: 28,
    minWidth: 100,
  },
  buttonText: {
    fontSize: 15,
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
    borderRadius: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 8,
    elevation: 5,
  },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 12,
  },
  checkbox: {
    width: 20,
    height: 20,
    borderRadius: 4,
    borderWidth: 2,
    marginRight: 10,
    justifyContent: 'center',
    alignItems: 'center',
  },
  checkmark: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '700',
  },
  optionText: {
    fontSize: 14,
    flexShrink: 1,
  },
  doneButton: {
    margin: 8,
    paddingVertical: 10,
    borderRadius: 6,
    alignItems: 'center',
  },
  doneButtonText: {
    fontSize: 14,
    fontWeight: '600',
  },
});
