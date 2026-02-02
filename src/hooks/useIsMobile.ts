import { useState, useEffect } from 'react';
import { Dimensions } from 'react-native';

export function useIsMobile(breakpoint = 768) {
  const [isMobile, setIsMobile] = useState(Dimensions.get('window').width < breakpoint);

  useEffect(() => {
    const subscription = Dimensions.addEventListener('change', ({ window }) => {
      setIsMobile(window.width < breakpoint);
    });
    return () => subscription.remove();
  }, [breakpoint]);

  return isMobile;
}
