import { describe, it, expect } from 'vitest';
import { getEncoding } from 'js-tiktoken';
import { treeSitterCSharpRuntime } from '../TreeSitterCSharpRuntime';
import { csharpCompressor } from '../CSharpCompressor';
import { DEFAULT_CSHARP_COMPRESSION_OPTIONS } from '@/core/constants/csharp-compression.constants';

const enc = getEncoding('cl100k_base');

describe('CSharpCompressor — Adversarial Syntax & Round-Trip Invariants', () => {
  it('preserves verbatim, raw, and interpolated strings containing comment-like sequences', () => {
    const src = `
namespace Demo {
  public class Paths {
    // real comment to strip
    public string WinPath = @"C:\\Users\\Admin\\//not-a-comment\\""quoted""";
    public string RawJson = """
      {
        "url": "https://example.com // keep",
        /* keep inside raw */
      }
      """;
    public string Interp(string x) => $"http://{x}/api /* keep */";
  }
}`;
    for (const level of ['clean', 'compact'] as const) {
      const { compressedText } = csharpCompressor.compress(src, {
        level,
        options: DEFAULT_CSHARP_COMPRESSION_OPTIONS,
      });
      expect(compressedText).not.toContain('real comment to strip');
      expect(compressedText).toContain(`@"C:\\Users\\Admin\\//not-a-comment\\""quoted"""`);
      expect(compressedText).toContain(`"url": "https://example.com // keep"`);
      expect(compressedText).toContain(`/* keep inside raw */`);
      expect(compressedText).toContain(`$"http://{x}/api /* keep */"`);

      const tree = treeSitterCSharpRuntime.parse(compressedText)!;
      expect(tree.rootNode.hasError).toBe(false);
      tree.delete();
    }
  });

  it('keeps block-scoped namespaces as block-scoped (does NOT convert to file-scoped)', () => {
    const src = `
namespace MyGame.Combat
{
    public class Sword
    {
        public int Damage = 10;
    }
}`;
    for (const level of ['clean', 'compact', 'skeleton', 'contract'] as const) {
      const { compressedText } = csharpCompressor.compress(src, {
        level,
        options: DEFAULT_CSHARP_COMPRESSION_OPTIONS,
      });
      expect(compressedText).toContain('namespace MyGame.Combat {');
      expect(compressedText).not.toContain('namespace MyGame.Combat;');
    }
  });

  it('condenses XML doc comments in L1 Clean and strips them in L2+', () => {
    const src = `
public class Auth {
  /// <summary>
  /// Validates the token.
  /// </summary>
  /// <param name="token">JWT bearer token.</param>
  /// <returns>True if valid.</returns>
  public bool Validate(string token) { return true; }
}`;
    const l1 = csharpCompressor.compress(src, {
      level: 'clean',
      options: DEFAULT_CSHARP_COMPRESSION_OPTIONS,
    });
    expect(l1.compressedText).toContain('/// Validates the token. @token: JWT bearer token. -> True if valid.');
    expect(l1.compressedText).not.toContain('<summary>');

    const l2 = csharpCompressor.compress(src, {
      level: 'compact',
      options: DEFAULT_CSHARP_COMPRESSION_OPTIONS,
    });
    expect(l2.compressedText).not.toContain('///');
  });

  it('removes unshadowed this. while strictly preserving shadowed this. in constructors/setters', () => {
    const src = `
public class User {
  private string name;
  private int _age;
  public User(string name, int initialAge) {
    this.name = name;
    this._age = initialAge;
  }
  public int Age {
    set { this._age = value; }
  }
}`;
    const { compressedText } = csharpCompressor.compress(src, {
      level: 'compact',
      options: DEFAULT_CSHARP_COMPRESSION_OPTIONS,
    });
    expect(compressedText).toContain('this.name = name;');
    expect(compressedText).toContain('_age = initialAge;');
    expect(compressedText).not.toContain('this._age');
  });

  it('preserves private inside private protected while stripping redundant private/public', () => {
    const src = `
public interface IService {
  public void Execute();
}
public class BaseService : IService {
  private int _x;
  private protected int _y;
  public void Execute() { }
}`;
    const { compressedText } = csharpCompressor.compress(src, {
      level: 'compact',
      options: DEFAULT_CSHARP_COMPRESSION_OPTIONS,
    });
    expect(compressedText).toContain('void Execute();');
    expect(compressedText).not.toContain('private int _x;');
    expect(compressedText).toContain('int _x;');
    expect(compressedText).toContain('private protected int _y;');
  });

  it('enforces column-0 newline invariants on #if/#else/#endif directives and strips #region', () => {
    const src = `
namespace UnityDemo {
  public class Platform {
    #region Setup
    public void Init() {
      #if UNITY_EDITOR
      SetupEditor();
      #else
      SetupRuntime();
      #endif
    }
    #endregion
  }
}`;
    const { compressedText } = csharpCompressor.compress(src, {
      level: 'compact',
      options: DEFAULT_CSHARP_COMPRESSION_OPTIONS,
    });
    expect(compressedText).not.toContain('#region');
    expect(compressedText).not.toContain('#endregion');
    expect(compressedText).toMatch(/\n#if UNITY_EDITOR\n/);
    expect(compressedText).toMatch(/\n#else\n/);
    expect(compressedText).toMatch(/\n#endif\n/);

    const tree = treeSitterCSharpRuntime.parse(compressedText)!;
    expect(tree.rootNode.hasError).toBe(false);
    tree.delete();
  });

  it('preserves Unity [SerializeField] in L4 Contract mode while stripping [Header]/[Tooltip]', () => {
    const src = `
using UnityEngine;
public class Enemy : MonoBehaviour {
  [Header("Stats")]
  [Tooltip("HP")]
  [SerializeField] private int _hp = 100;
  private int _runtimeCache;
  public void TakeHit(int dmg) { _hp -= dmg; }
  private void InternalReset() { _runtimeCache = 0; }
}`;
    const { compressedText } = csharpCompressor.compress(src, {
      level: 'contract',
      options: { ...DEFAULT_CSHARP_COMPRESSION_OPTIONS, preserveUnitySerializedFields: true },
    });
    expect(compressedText).toContain('[SerializeField]');
    expect(compressedText).toContain('_hp');
    expect(compressedText).not.toContain('[Header');
    expect(compressedText).not.toContain('[Tooltip');
    expect(compressedText).not.toContain('_runtimeCache');
    expect(compressedText).not.toContain('InternalReset');
    expect(compressedText).toContain('public void TakeHit(int dmg);');

    const rawTok = enc.encode(src).length;
    const compTok = enc.encode(compressedText).length;
    expect(compTok).toBeLessThan(rawTok * 0.55);
  });

  it('does not strip diagnostic logs when arguments have side effects', () => {
    const src = `
public class Worker {
  public void Run() {
    Debug.Log("Started");
    Debug.Log(IncrementCounter());
  }
  int IncrementCounter() => 1;
}`;
    const { compressedText } = csharpCompressor.compress(src, {
      level: 'compact',
      options: { ...DEFAULT_CSHARP_COMPRESSION_OPTIONS, stripDiagnosticLogsInCompact: true },
    });
    expect(compressedText).not.toContain('Debug.Log("Started")');
    expect(compressedText).toContain('Debug.Log(IncrementCounter())');
  });

  it('deduplicates exact T x = new T() to target-typed new() while preserving interface abstractions', () => {
    const src = `
using System.Collections.Generic;
public class Repo {
  private readonly List<string> _items = new List<string>();
  public void Run() {
    Dictionary<string, int> map = new Dictionary<string, int>();
    IList<string> list = new List<string>();
  }
}`;
    const { compressedText } = csharpCompressor.compress(src, {
      level: 'clean',
      options: DEFAULT_CSHARP_COMPRESSION_OPTIONS,
    });
    expect(compressedText).toContain('List<string> _items = new();');
    expect(compressedText).toContain('Dictionary<string, int> map = new();');
    expect(compressedText).toContain('IList<string> list = new List<string>();');
  });

  it('truncates large literal arrays in L3 and emits call-graph stubs', () => {
    const src = `
public class Table {
  private static readonly int[] Lookup = { 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12 };
  public int Compute(int x) {
    Validate(x);
    var a = Transform(x);
    var b = Finalize(a);
    if (b < 0) throw new InvalidOperationException();
    return b;
  }
}`;
    const { compressedText } = csharpCompressor.compress(src, {
      level: 'skeleton',
      options: DEFAULT_CSHARP_COMPRESSION_OPTIONS,
    });
    expect(compressedText).toContain('/* +8 items */');
    expect(compressedText).toContain('calls: Validate, Transform, Finalize');
    expect(compressedText).toContain('throws: InvalidOperationException');
  });

  it('gracefully degrades without throwing on syntax-broken C# files', () => {
    const broken = `public class Broken { public void Foo( { // comment\n int x = ; }`;
    const result = csharpCompressor.compress(broken, {
      level: 'skeleton',
      options: DEFAULT_CSHARP_COMPRESSION_OPTIONS,
    });
    expect(result.hadSyntaxErrors).toBe(true);
    expect(result.compressedText).toContain('public class Broken');
  });
});
