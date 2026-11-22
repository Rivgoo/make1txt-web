import { describe, it, expect } from 'vitest';
import { getEncoding } from 'js-tiktoken';
import { treeSitterCSharpRuntime } from '../TreeSitterCSharpRuntime';
import { csharpCompressor } from '../CSharpCompressor';
import { DEFAULT_CSHARP_COMPRESSION_OPTIONS } from '@/core/constants/csharp-compression.constants';

const enc = getEncoding('cl100k_base');

const FIXTURES: Record<string, string> = {
  unityController: `
using System;
using System.Collections.Generic;
using UnityEngine;
using MyGame.Combat.Events;

namespace MyGame.Combat.Health
{
    /// <summary>
    /// Manages entity health, damage mitigation, and death event dispatching.
    /// </summary>
    public class HealthController : MonoBehaviour, IDamageable
    {
        #region Serialized Fields
        [Header("Health Configuration")]
        [Tooltip("Maximum hit points for this entity.")]
        [SerializeField]
        private float _maxHealth = 100f;

        [Space]
        [SerializeField]
        private bool _isInvulnerable;
        #endregion

        private float _currentHealth;
        private readonly List<IDamageModifier> _modifiers = new List<IDamageModifier>();

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
            OnDamaged?.Invoke(new DamageEvent(finalDamage));
            return finalDamage;
        }

        private float CalculateMitigatedDamage(float raw)
        {
            float result = raw;
            foreach (var mod in _modifiers)
            {
                result = mod.Apply(result);
            }
            return result;
        }
    }
}`,

  aspnetController: `
using System.Threading.Tasks;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Logging;
using MyApp.Services;

namespace MyApp.Controllers
{
    [ApiController]
    [Route("api/[controller]")]
    public class OrdersController : ControllerBase
    {
        private readonly IOrderService _orderService;
        private readonly ILogger<OrdersController> _logger;

        public OrdersController(IOrderService orderService, ILogger<OrdersController> logger)
        {
            this._orderService = orderService;
            this._logger = logger;
        }

        [HttpGet("{id}")]
        public async Task<IActionResult> GetOrder(int id)
        {
            _logger.LogInformation("Fetching order {Id}", id);
            var order = await _orderService.GetByIdAsync(id);
            if (order == null)
            {
                return NotFound();
            }
            return Ok(order);
        }
    }
}`,

  modernCSharpFeatures: `
using System;
using System.Collections.Generic;

namespace ModernDemo
{
    public record OrderDto(int Id, string CustomerName, decimal Total);

    public class PrimaryCtorService(string connectionString, int timeout)
    {
        private readonly string _conn = connectionString;
        private readonly int _timeout = timeout;

        public required string Region { get; init; }

        public int[] GetDefaults() => [1, 2, 3];
    }
}`,
};

describe('CSharpCompressor — Parse-Tree Round-Trip & Monotonicity Invariants', () => {
  for (const [name, source] of Object.entries(FIXTURES)) {
    it(`preserves zero syntax errors and monotonic token reduction across L0..L4 for ${name}`, () => {
      const tokenCounts: number[] = [enc.encode(source).length];

      for (const level of ['clean', 'compact', 'skeleton', 'contract'] as const) {
        const res = csharpCompressor.compress(source, {
          level,
          options: DEFAULT_CSHARP_COMPRESSION_OPTIONS,
        });

        const reParsed = treeSitterCSharpRuntime.parse(res.compressedText);
        expect(reParsed).not.toBeNull();
        expect(reParsed!.rootNode.hasError).toBe(false);
        reParsed!.delete();

        tokenCounts.push(enc.encode(res.compressedText).length);
      }

      // Monotonic: L0 >= L1 >= L2 >= L3 >= L4
      for (let i = 1; i < tokenCounts.length; i++) {
        expect(tokenCounts[i]).toBeLessThanOrEqual(tokenCounts[i - 1]);
      }
    });
  }
});
