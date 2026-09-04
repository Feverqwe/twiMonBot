import en from './locale/en';
import ru from './locale/ru';

const languages = {
  en,
  ru,
};

class Locale {
  private readonly dictionary: typeof en;

  constructor(code: string) {
    this.dictionary = languages[code as keyof typeof languages] || languages.en;
  }

  getMessage = (
    messageName: keyof (typeof languages)[keyof typeof languages],
    variables?: Record<string, number | string>,
  ) => {
    const message = this.dictionary[messageName];
    return message.replace(/\{([^}]+)}/g, (text, variable: string) => {
      return String(variables?.[variable] ?? variable);
    });
  };
  m = this.getMessage;
}

export default Locale;
