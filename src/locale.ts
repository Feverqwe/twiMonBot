import en from './locale/en';

const languages = {
  en,
};

class Locale {
  private readonly dictionary: typeof en;

  constructor(code: string) {
    this.dictionary = languages[code as keyof typeof languages] || languages.en;
  }

  public getMessage = (
    messageName: keyof (typeof languages)[keyof typeof languages],
    variables?: Record<string, number | string>,
  ) => {
    const message = this.dictionary[messageName];
    return message.replace(/\{([^}]+)}/g, (text, variable: string) => {
      return String(variables?.[variable] ?? variable);
    });
  };
  public m = this.getMessage;
}

export default Locale;
