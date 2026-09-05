import en from './locale/en';
import ru from './locale/ru';

type MessageName = keyof typeof en;
type Dictionary = Record<MessageName, string>;

type Placeholder<Message extends string> = Message extends `${string}{${infer Name}}${infer Rest}`
  ? Name | Placeholder<Rest>
  : never;

type MessageArguments<Message extends string> = [Placeholder<Message>] extends [never]
  ? []
  : [variables: Record<Placeholder<Message>, number | string>];

type MatchingDictionary<Translation extends Dictionary> = {
  [Name in MessageName]: [Placeholder<Translation[Name]>] extends [Placeholder<(typeof en)[Name]>]
    ? [Placeholder<(typeof en)[Name]>] extends [Placeholder<Translation[Name]>]
      ? Translation[Name]
      : never
    : never;
};

const languages = {
  en,
  ru: ru satisfies MatchingDictionary<typeof ru>,
} satisfies Record<string, Dictionary>;

function isLanguage(code: string): code is keyof typeof languages {
  return Object.hasOwn(languages, code);
}

class Locale {
  private readonly dictionary: Dictionary;

  constructor(code: string) {
    const normalizedCode = code.split('-')[0];
    this.dictionary = isLanguage(normalizedCode) ? languages[normalizedCode] : languages.en;
  }

  getMessage = <Name extends MessageName>(
    messageName: Name,
    ...[variables]: MessageArguments<(typeof en)[Name]>
  ) => {
    const message = this.dictionary[messageName];
    const values: Record<string, number | string> | undefined = variables;
    return message.replace(/\{([^}]+)}/g, (text, variable: string) => {
      return String(values?.[variable] ?? variable);
    });
  };
  m = this.getMessage;
}

export default Locale;
