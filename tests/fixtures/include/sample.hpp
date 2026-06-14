/**
 * @file sample.hpp
 * @brief Synthetic API surface that exercises the shared Doxygen template.
 *
 * Nothing here is real. It exists so a docs-shared PR can confirm that groups,
 * classes, templates, enums, parameter tables, admonitions, code blocks and
 * cross-references all still render with the shared template.
 */

#pragma once

#include <cstdint>
#include <span>
#include <string_view>

/**
 * @defgroup preview_fixtures Preview fixtures
 * @brief Everything in this header belongs to a single documentation group.
 * @{
 */

/// The engine's top-level namespace (synthetic).
namespace liara::preview {

/**
 * @brief Severity levels for a synthetic log channel.
 *
 * Documented enumerators show up in the member table.
 */
enum class Severity : std::uint8_t {
    Trace,   ///< Verbose tracing, usually disabled.
    Info,    ///< Normal operational messages.
    Warning, ///< Recoverable problems.
    Fatal    ///< Unrecoverable; the process should stop.
};

/**
 * @brief A fixed-capacity ring buffer.
 *
 * @tparam T        Element type. Must be trivially copyable.
 * @tparam Capacity Maximum number of live elements.
 *
 * @note This type performs no heap allocation.
 * @warning Pushing into a full buffer overwrites the oldest element.
 */
template <typename T, std::size_t Capacity>
class RingBuffer {
public:
    /// Constructs an empty buffer.
    constexpr RingBuffer() noexcept = default;

    /**
     * @brief Appends an element, overwriting the oldest if full.
     * @param value The element to store.
     * @return @c true if an element was overwritten, @c false otherwise.
     */
    constexpr bool push(const T& value) noexcept;

    /**
     * @brief Number of live elements.
     * @return A value in the range <tt>[0, Capacity]</tt>.
     */
    [[nodiscard]] constexpr std::size_t size() const noexcept { return size_; }

private:
    T data_[Capacity]{};   ///< Backing storage.
    std::size_t head_ = 0; ///< Index of the next write.
    std::size_t size_ = 0; ///< Live element count.
};

/**
 * @brief Formats a severity level for display.
 *
 * Example:
 * @code{.cpp}
 * auto label = liara::preview::to_string(liara::preview::Severity::Warning);
 * // label == "warning"
 * @endcode
 *
 * @param level The severity to format.
 * @return A stable, lowercase string view. Never empty.
 * @see Severity
 */
[[nodiscard]] std::string_view to_string(Severity level) noexcept;

/**
 * @brief Sums a span of integers.
 * @deprecated Use the ranges-based overload instead. Kept to exercise the
 *             "deprecated" admonition in the template.
 * @param values The integers to add.
 * @return Their sum, or @c 0 for an empty span. See @ref to_string for the
 *         unrelated string helper.
 */
[[deprecated]] std::int64_t sum(std::span<const std::int32_t> values) noexcept;

} // namespace liara::preview

/** @} */ // end of preview_fixtures