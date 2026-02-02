import React, { useCallback, useMemo, memo } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useTheme } from '../contexts/ThemeContext';
import {
  PhysicalTag,
  PHYSICAL_TAG_LABELS,
  PHYSICAL_TAG_CATEGORIES,
} from '../types';

interface TagButtonProps {
  tag: PhysicalTag;
  isSelected: boolean;
  onPress: (tag: PhysicalTag) => void;
}

// Memoized individual tag button component
const TagButton = memo<TagButtonProps>(function TagButton({ tag, isSelected, onPress }) {
  const { colors } = useTheme();

  const handlePress = useCallback(() => {
    onPress(tag);
  }, [tag, onPress]);

  return (
    <TouchableOpacity
      style={[
        styles.tag,
        {
          backgroundColor: isSelected ? colors.primary : colors.surfaceSecondary,
          borderColor: isSelected ? colors.primary : colors.border,
        },
      ]}
      onPress={handlePress}
      activeOpacity={0.7}
    >
      <Text
        style={[
          styles.tagText,
          { color: isSelected ? colors.primaryText : colors.text },
        ]}
      >
        {PHYSICAL_TAG_LABELS[tag]}
      </Text>
    </TouchableOpacity>
  );
});

TagButton.displayName = 'TagButton';

interface CategorySectionProps {
  category: string;
  tags: PhysicalTag[];
  selectedTags: PhysicalTag[];
  onTagToggle: (tag: PhysicalTag) => void;
}

// Memoized category section component
const CategorySection = memo<CategorySectionProps>(function CategorySection({
  category,
  tags,
  selectedTags,
  onTagToggle,
}) {
  const { colors } = useTheme();

  return (
    <View style={styles.categoryContainer}>
      <Text style={[styles.categoryTitle, { color: colors.textSecondary }]}>
        {category}
      </Text>
      <View style={styles.tagsContainer}>
        {tags.map((tag) => (
          <TagButton
            key={tag}
            tag={tag}
            isSelected={selectedTags.includes(tag)}
            onPress={onTagToggle}
          />
        ))}
      </View>
    </View>
  );
});

CategorySection.displayName = 'CategorySection';

interface PhysicalTagSelectorProps {
  selectedTags: PhysicalTag[];
  onTagToggle: (tag: PhysicalTag) => void;
}

export const PhysicalTagSelector = memo<PhysicalTagSelectorProps>(function PhysicalTagSelector({
  selectedTags,
  onTagToggle,
}) {
  // Memoize categories to avoid re-creating on every render
  const categories = useMemo(
    () => Object.entries(PHYSICAL_TAG_CATEGORIES) as [string, PhysicalTag[]][],
    []
  );

  return (
    <View style={styles.container}>
      {categories.map(([category, tags]) => (
        <CategorySection
          key={category}
          category={category}
          tags={tags}
          selectedTags={selectedTags}
          onTagToggle={onTagToggle}
        />
      ))}
    </View>
  );
});

PhysicalTagSelector.displayName = 'PhysicalTagSelector';

const styles = StyleSheet.create({
  container: {
    gap: 16,
  },
  categoryContainer: {
    gap: 8,
  },
  categoryTitle: {
    fontSize: 13,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  tagsContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  tag: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1,
  },
  tagText: {
    fontSize: 14,
    fontWeight: '500',
  },
});
