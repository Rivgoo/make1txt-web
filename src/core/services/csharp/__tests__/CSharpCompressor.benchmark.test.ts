import { describe, it, expect } from 'vitest';
import { getEncoding } from 'js-tiktoken';
import { csharpCompressor } from '../CSharpCompressor';
import { DEFAULT_CSHARP_COMPRESSION_OPTIONS } from '@/core/constants/csharp-compression.constants';

const enc = getEncoding('cl100k_base');

const BENCHMARK_UNITY_FILE = `
using System;
using System.Collections.Generic;
using UnityEngine;
using MyGame.Combat.Events;

namespace MyGame.Combat.Health
{
    /// <summary>
    /// Manages entity health, damage mitigation, resistance calculation, and death event dispatching.
    /// </summary>
    public class HealthController : MonoBehaviour, IDamageable
    {
        #region Serialized Fields
        [Header("Health Configuration")]
        [Tooltip("Maximum hit points for this entity.")]
        [SerializeField]
        private float _maxHealth = 100f;

        [Tooltip("Whether the entity is currently invulnerable.")]
        [Space]
        [SerializeField]
        private bool _isInvulnerable;
        #endregion

        #region Private State
        private float _currentHealth;
        private readonly List<IDamageModifier> _modifiers = new List<IDamageModifier>();
        private readonly Dictionary<string, float> _resistances = new Dictionary<string, float>();
        #endregion

        /// <summary>
        /// Gets the normalized health ratio between 0 and 1.
        /// </summary>
        public float HealthRatio
        {
            get
            {
                return this._maxHealth > 0f ? this._currentHealth / this._maxHealth : 0f;
            }
        }

        public event Action<DamageEvent> OnDamaged;

        private void Awake()
        {
            this._currentHealth = this._maxHealth;
        }

        /// <summary>
        /// Applies incoming damage after evaluating all active modifiers and resistances.
        /// </summary>
        /// <param name="amount">Raw incoming damage value.</param>
        /// <returns>Final applied damage.</returns>
        public float ApplyDamage(float amount)
        {
            if (amount < 0f)
            {
                throw new ArgumentOutOfRangeException(nameof(amount));
            }

            if (this._isInvulnerable || this._currentHealth <= 0f)
            {
                Debug.Log($"[Health] Ignored damage {amount} on {name}");
                return 0f;
            }

            float finalDamage = CalculateMitigatedDamage(amount);
            this._currentHealth = Math.Max(0f, this._currentHealth - finalDamage);
            Debug.Log($"[Health] Applied {finalDamage} damage. Remaining: {this._currentHealth}");
            OnDamaged?.Invoke(new DamageEvent(finalDamage));
            return finalDamage;
        }

        private float CalculateMitigatedDamage(float raw)
        {
            float result = raw;
            for (int i = 0; i < _modifiers.Count; i++)
            {
                result = _modifiers[i].Apply(result);
            }
            if (_resistances.TryGetValue("Physical", out float res))
            {
                result *= (1f - res);
            }
            return result;
        }
    }
}`;

describe('CSharpCompressor — BPE Token Reduction & Latency Benchmark', () => {
  it('achieves target cl100k_base token reduction thresholds across L1..L4', () => {
    const rawTokens = enc.encode(BENCHMARK_UNITY_FILE).length;

    const l1 = csharpCompressor.compress(BENCHMARK_UNITY_FILE, {
      level: 'clean',
      options: DEFAULT_CSHARP_COMPRESSION_OPTIONS,
    });
    const l2 = csharpCompressor.compress(BENCHMARK_UNITY_FILE, {
      level: 'compact',
      options: DEFAULT_CSHARP_COMPRESSION_OPTIONS,
    });
    const l3 = csharpCompressor.compress(BENCHMARK_UNITY_FILE, {
      level: 'skeleton',
      options: DEFAULT_CSHARP_COMPRESSION_OPTIONS,
    });
    const l4 = csharpCompressor.compress(BENCHMARK_UNITY_FILE, {
      level: 'contract',
      options: DEFAULT_CSHARP_COMPRESSION_OPTIONS,
    });

    const r1 = 1 - enc.encode(l1.compressedText).length / rawTokens;
    const r2 = 1 - enc.encode(l2.compressedText).length / rawTokens;
    const r3 = 1 - enc.encode(l3.compressedText).length / rawTokens;
    const r4 = 1 - enc.encode(l4.compressedText).length / rawTokens;

    expect(r1).toBeGreaterThanOrEqual(0.2);
    expect(r2).toBeGreaterThanOrEqual(0.4);
    expect(r3).toBeGreaterThanOrEqual(0.55);
    expect(r4).toBeGreaterThanOrEqual(0.75);
  });
});
